/**
 * Kondaas Invoice Template Generator
 * @param {Object} data - The invoice and customer data from the DB
 */
export const getInvoiceTemplate = (lead) => {
    return `
<!DOCTYPE html>
<html>
<head>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: sans-serif; padding: 20px; color: #333; }
        
        /* The Fixed Header from your photo */
        .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            border-bottom: 2px solid #c0392b;
            padding-bottom: 10px;
            margin-bottom: 30px;
        }
        .logo-area img {
            width: 180px; /* Adjust based on your preference */
        }
        .company-details {
            text-align: right;
            font-size: 10px;
            line-height: 1.4;
        }
        .company-name {
            font-size: 16px;
            font-weight: bold;
            color: #1a1a1a;
        }
        
        /* Testing Area */
        .test-box {
            border: 2px dashed #f39c12;
            padding: 20px;
            background: #fffdf0;
        }
        h2 { color: #2c3e50; margin-bottom: 10px; }
        .data-row { margin: 8px 0; font-size: 14px; }
        .label { font-weight: bold; color: #7f8c8d; width: 150px; display: inline-block; }
    </style>
</head>
<body>

    <div class="header">
        <div class="logo-area">
            <!-- Using a placeholder for now, you can swap for your Base64 string -->
            <h1 style="color: #c0392b; font-style: italic;">kondaas</h1>
        </div>
        <div class="company-details">
            <p class="company-name">Kondaas Automation Pvt Ltd</p>
            <p>5B, SRI ALAMELU NAGAR, KAMARAJAR ROAD</p>
            <p>Warehouse: S.F.NO.365, HARI GARDEN, UPPILIPALAYAM POST</p>
            <p>Coimbatore, Tamil Nadu, 641015</p>
            <p>Phone: 04222574000 | Mobile: 9244414441</p>
            <p>GSTIN: 33AAACK7337F1ZR | State: Tamil Nadu</p>
            <p style="font-style: italic; color: #888;">Original For Recipient</p>
        </div>
    </div>

    <div class="test-box">
        <h2>📊 MongoDB Data Connection Test</h2>
        <hr>
        <div class="data-row">
            <span class="label">Consumer Name:</span> 
            <span>${lead.consumerName || lead.name || "❌ Field Not Found"}</span>
        </div>
        <div class="data-row">
            <span class="label">Phone:</span> 
            <span>${lead.mobile || "❌ Field Not Found"}</span>
        </div>
        <div class="data-row">
            <span class="label">State:</span> 
            <span>${lead.state || "Tamil Nadu"}</span>
        </div>
        <div class="data-row">
            <span class="label">Lead ID:</span> 
            <span>${lead._id || "N/A"}</span>
        </div>
    </div>

    <p style="margin-top: 20px; font-size: 10px; color: #aaa; text-align: center;">
        System Test Generated on: ${new Date().toLocaleString()}
    </p>

</body>
</html>
    `;
};