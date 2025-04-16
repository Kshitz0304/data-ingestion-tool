document.addEventListener('DOMContentLoaded', function() {
    // UI Elements
    const sourceTypeRadios = document.querySelectorAll('input[name="sourceType"]');
    const clickhouseForm = document.getElementById('clickhouseForm');
    const flatfileForm = document.getElementById('flatfileForm');
    const connectBtn = document.getElementById('connectBtn');
    const loadFileBtn = document.getElementById('loadFileBtn');
    const tablesSection = document.getElementById('tablesSection');
    const tablesSelect = document.getElementById('tablesSelect');
    const loadColumnsBtn = document.getElementById('loadColumnsBtn');
    const columnsSection = document.getElementById('columnsSection');
    const columnsList = document.getElementById('columnsList');
    const ingestBtn = document.getElementById('ingestBtn');
    const statusText = document.getElementById('statusText');
    const progressBarContainer = document.getElementById('progressBarContainer');
    const progressBar = document.getElementById('progressBar');
    const infoAlert = document.getElementById('infoAlert');
    const successAlert = document.getElementById('successAlert');
    const errorAlert = document.getElementById('errorAlert');
    const resultsContent = document.getElementById('resultsContent');
    const downloadBtn = document.getElementById('downloadBtn');
    const targetConfig = document.getElementById('targetConfig');
    const targetTableSection = document.getElementById('targetTableSection');
    
    // Current state
    let currentSourceType = 'clickhouse';
    let currentColumns = [];
    let currentFilepath = '';
    let currentTable = '';
    let selectedColumns = [];
    
    // Event listeners for source type change
    sourceTypeRadios.forEach(radio => {
        radio.addEventListener('change', function() {
            currentSourceType = this.value;
            if (currentSourceType === 'clickhouse') {
                clickhouseForm.style.display = 'block';
                flatfileForm.style.display = 'none';
                tablesSection.style.display = 'none';
                columnsSection.style.display = 'none';
                targetConfig.style.display = 'none';
            } else {
                clickhouseForm.style.display = 'none';
                flatfileForm.style.display = 'block';
                tablesSection.style.display = 'none';
                columnsSection.style.display = 'none';
                targetConfig.style.display = 'none';
            }
            clearAlerts();
        });
    });
    
    // Connect to ClickHouse
    connectBtn.addEventListener('click', async function() {
        clearAlerts();
        statusText.textContent = 'Connecting to ClickHouse...';
        
        try {
            const response = await fetch('/connect', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    sourceType: 'clickhouse',
                    host: document.getElementById('host').value,
                    port: parseInt(document.getElementById('port').value),
                    database: document.getElementById('database').value,
                    user: document.getElementById('user').value,
                    jwtToken: document.getElementById('jwtToken').value
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                showInfo('Successfully connected to ClickHouse');
                statusText.textContent = 'Connected to ClickHouse';
                
                // Populate tables dropdown
                tablesSelect.innerHTML = '';
                data.tables.forEach(table => {
                    const option = document.createElement('option');
                    option.value = table;
                    option.textContent = table;
                    tablesSelect.appendChild(option);
                });
                
                tablesSection.style.display = 'block';
                targetConfig.style.display = 'block';
                targetTableSection.style.display = currentSourceType === 'clickhouse' ? 'none' : 'block';
            } else {
                throw new Error(data.error || 'Failed to connect');
            }
        } catch (error) {
            showError(error.message);
            statusText.textContent = 'Connection failed';
        }
    });
    
    // Load file for Flat File source
    loadFileBtn.addEventListener('click', async function() {
        clearAlerts();
        const fileInput = document.getElementById('file');
        const file = fileInput.files[0];
        
        if (!file) {
            showError('Please select a file');
            return;
        }
        
        statusText.textContent = 'Loading file...';
        
        const formData = new FormData();
        formData.append('file', file);
        formData.append('sourceType', 'flatfile');
        formData.append('delimiter', document.getElementById('delimiter').value);
        
        try {
            const response = await fetch('/columns', {
                method: 'POST',
                body: formData
            });
            
            const data = await response.json();
            
            if (data.success) {
                showInfo('File loaded successfully');
                statusText.textContent = 'File loaded';
                currentFilepath = data.filepath;
                currentColumns = data.columns;
                
                // Display columns for selection
                displayColumns(currentColumns);
                columnsSection.style.display = 'block';
                targetConfig.style.display = 'block';
                targetTableSection.style.display = 'block';
            } else {
                throw new Error(data.error || 'Failed to load file');
            }
        } catch (error) {
            showError(error.message);
            statusText.textContent = 'File loading failed';
        }
    });
    
    // Load columns for ClickHouse table
    loadColumnsBtn.addEventListener('click', async function() {
        clearAlerts();
        currentTable = tablesSelect.value;
        
        if (!currentTable) {
            showError('Please select a table');
            return;
        }
        
        statusText.textContent = `Loading columns for table ${currentTable}...`;
        
        try {
            const response = await fetch('/columns', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    sourceType: 'clickhouse',
                    host: document.getElementById('host').value,
                    port: parseInt(document.getElementById('port').value),
                    database: document.getElementById('database').value,
                    user: document.getElementById('user').value,
                    jwtToken: document.getElementById('jwtToken').value,
                    table: currentTable
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                showInfo(`Successfully loaded columns for table ${currentTable}`);
                statusText.textContent = `Columns loaded for table ${currentTable}`;
                currentColumns = data.columns;
                
                // Display columns for selection
                displayColumns(currentColumns);
                columnsSection.style.display = 'block';
            } else {
                throw new Error(data.error || 'Failed to load columns');
            }
        } catch (error) {
            showError(error.message);
            statusText.textContent = 'Column loading failed';
        }
    });
    
    // Start ingestion process
    ingestBtn.addEventListener('click', async function() {
        clearAlerts();
        
        if (selectedColumns.length === 0) {
            showError('Please select at least one column');
            return;
        }
        
        statusText.textContent = 'Starting data ingestion...';
        progressBarContainer.style.display = 'block';
        progressBar.style.width = '0%';
        
        try {
            let requestBody = {
                sourceType: currentSourceType,
                selectedColumns: selectedColumns
            };
            
            // Add common fields
            if (currentSourceType === 'clickhouse') {
                Object.assign(requestBody, {
                    host: document.getElementById('host').value,
                    port: parseInt(document.getElementById('port').value),
                    database: document.getElementById('database').value,
                    user: document.getElementById('user').value,
                    jwtToken: document.getElementById('jwtToken').value,
                    table: currentTable
                });
            } else {
                Object.assign(requestBody, {
                    filepath: currentFilepath,
                    delimiter: document.getElementById('delimiter').value,
                    targetTable: document.getElementById('targetTable').value || 'imported_data_' + Math.random().toString(36).substring(2, 8)
                });
            }
            
            const response = await fetch('/ingest', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody)
            });
            
            const data = await response.json();
            
            if (data.success) {
                showSuccess(data.message);
                statusText.textContent = 'Ingestion completed successfully';
                progressBar.style.width = '100%';
                
                // Display results
                resultsContent.innerHTML = `
                    <h6>${data.message}</h6>
                    ${currentSourceType === 'clickhouse' ? 
                        `<p>File generated: ${data.filename}</p>` : 
                        `<p>Data imported to table: ${data.table}</p>`}
                `;
                
                if (currentSourceType === 'clickhouse') {
                    downloadBtn.style.display = 'inline-block';
                    downloadBtn.onclick = function() {
                        window.location.href = `/download/${data.filename}`;
                    };
                } else {
                    downloadBtn.style.display = 'none';
                }
            } else {
                throw new Error(data.error || 'Ingestion failed');
            }
        } catch (error) {
            showError(error.message);
            statusText.textContent = 'Ingestion failed';
            progressBar.style.width = '0%';
            progressBarContainer.style.display = 'none';
        }
    });
    
    // Helper functions
    function displayColumns(columns) {
        columnsList.innerHTML = '';
        selectedColumns = [];
        
        columns.forEach(column => {
            const div = document.createElement('div');
            div.className = 'column-item';
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `col-${column.name}`;
            checkbox.className = 'form-check-input column-checkbox';
            checkbox.value = column.name;
            
            checkbox.addEventListener('change', function() {
                if (this.checked) {
                    selectedColumns.push(this.value);
                } else {
                    selectedColumns = selectedColumns.filter(col => col !== this.value);
                }
            });
            
            const label = document.createElement('label');
            label.htmlFor = `col-${column.name}`;
            label.className = 'form-check-label';
            label.textContent = `${column.name} (${column.type})`;
            
            div.appendChild(checkbox);
            div.appendChild(label);
            columnsList.appendChild(div);
        });
    }
    
    function showInfo(message) {
        infoAlert.textContent = message;
        infoAlert.style.display = 'block';
        setTimeout(() => {
            infoAlert.style.display = 'none';
        }, 5000);
    }
    
    function showSuccess(message) {
        successAlert.textContent = message;
        successAlert.style.display = 'block';
    }
    
    function showError(message) {
        errorAlert.textContent = message;
        errorAlert.style.display = 'block';
    }
    
    function clearAlerts() {
        infoAlert.style.display = 'none';
        successAlert.style.display = 'none';
        errorAlert.style.display = 'none';
    }
});