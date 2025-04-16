import os
from flask import Flask, request, jsonify, send_from_directory
from clickhouse_driver import Client
import pandas as pd
from werkzeug.utils import secure_filename
import uuid
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__, static_folder='static')
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['ALLOWED_EXTENSIONS'] = {'csv', 'tsv', 'txt'}
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)


def allowed_file(filename):
    return '.' in filename and \
        filename.rsplit('.', 1)[1].lower() in app.config['ALLOWED_EXTENSIONS']


def get_clickhouse_client(host, port, database, user, jwt_token=None):
    settings = {}
    if jwt_token:
        settings = {'jwt': jwt_token}
    return Client(host=host, port=port, database=database, user=user, settings=settings)


@app.route('/')
def index():
    return send_from_directory('static', 'index.html')


@app.route('/connect', methods=['POST'])
def connect():
    data = request.json
    source_type = data.get('sourceType')

    if source_type == 'clickhouse':
        try:
            client = get_clickhouse_client(
                host=data.get('host'),
                port=data.get('port'),
                database=data.get('database'),
                user=data.get('user'),
                jwt_token=data.get('jwtToken')
            )
            tables = client.execute('SHOW TABLES')
            return jsonify({'success': True, 'tables': [table[0] for table in tables]})
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 400

    return jsonify({'success': False, 'error': 'Invalid source type'}), 400


@app.route('/columns', methods=['POST'])
def get_columns():
    data = request.json
    source_type = data.get('sourceType')

    if source_type == 'clickhouse':
        try:
            client = get_clickhouse_client(
                host=data.get('host'),
                port=data.get('port'),
                database=data.get('database'),
                user=data.get('user'),
                jwt_token=data.get('jwtToken')
            )
            table = data.get('table')
            columns = client.execute(f'DESCRIBE TABLE {table}')
            return jsonify({'success': True, 'columns': [{'name': col[0], 'type': col[1]} for col in columns]})
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 400
    elif source_type == 'flatfile':
        if 'file' in request.files:
            file = request.files['file']
            if file and allowed_file(file.filename):
                filename = secure_filename(file.filename)
                filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
                file.save(filepath)

                # Read first few rows to get columns
                try:
                    delimiter = data.get('delimiter', ',')
                    df = pd.read_csv(filepath, nrows=5, delimiter=delimiter)
                    return jsonify({
                        'success': True,
                        'columns': [{'name': col, 'type': 'string'} for col in df.columns],
                        'filepath': filename
                    })
                except Exception as e:
                    return jsonify({'success': False, 'error': str(e)}), 400
        return jsonify({'success': False, 'error': 'No file uploaded'}), 400

    return jsonify({'success': False, 'error': 'Invalid source type'}), 400


@app.route('/ingest', methods=['POST'])
def ingest_data():
    data = request.json
    source_type = data.get('sourceType')
    selected_columns = data.get('selectedColumns', [])

    try:
        if source_type == 'clickhouse':
            # ClickHouse to Flat File
            client = get_clickhouse_client(
                host=data.get('host'),
                port=data.get('port'),
                database=data.get('database'),
                user=data.get('user'),
                jwt_token=data.get('jwtToken')
            )
            table = data.get('table')
            columns_str = ', '.join(selected_columns)
            query = f'SELECT {columns_str} FROM {table}'
            result = client.execute(query, with_column_types=True)

            # Convert to DataFrame
            columns = [col[0] for col in result[1]]
            df = pd.DataFrame(result[0], columns=columns)

            # Save to CSV
            output_filename = f"output_{uuid.uuid4().hex}.csv"
            output_path = os.path.join(app.config['UPLOAD_FOLDER'], output_filename)
            df.to_csv(output_path, index=False)

            return jsonify({
                'success': True,
                'message': f'Successfully exported {len(df)} records',
                'filename': output_filename
            })

        elif source_type == 'flatfile':
            # Flat File to ClickHouse
            filepath = os.path.join(app.config['UPLOAD_FOLDER'], data.get('filepath'))
            delimiter = data.get('delimiter', ',')
            df = pd.read_csv(filepath, usecols=selected_columns, delimiter=delimiter)

            client = get_clickhouse_client(
                host=data.get('host'),
                port=data.get('port'),
                database=data.get('database'),
                user=data.get('user'),
                jwt_token=data.get('jwtToken')
            )

            target_table = data.get('targetTable', 'imported_data_' + uuid.uuid4().hex[:8])

            # Create table
            create_table_sql = f"""
            CREATE TABLE IF NOT EXISTS {target_table} (
                {', '.join([f'{col} String' for col in selected_columns])}
            ) ENGINE = MergeTree()
            ORDER BY tuple()
            """
            client.execute(create_table_sql)

            # Insert data
            data_to_insert = [tuple(row) for row in df.values]
            client.execute(
                f'INSERT INTO {target_table} ({", ".join(selected_columns)}) VALUES',
                data_to_insert
            )

            return jsonify({
                'success': True,
                'message': f'Successfully imported {len(df)} records into table {target_table}',
                'table': target_table
            })

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 400

    return jsonify({'success': False, 'error': 'Invalid source type'}), 400


@app.route('/download/<filename>')
def download_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename, as_attachment=True)


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)