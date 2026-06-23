export const getInvoiceTemplate = (lead) => {
  // ── 1. Helper: Number to Words ──────────────────────────────────────────
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const toWords = (n) => {
    n = Math.round(n);
    if (n === 0) return 'Zero';
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
    if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + toWords(n % 100) : '');
    if (n < 100000) return toWords(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + toWords(n % 1000) : '');
    if (n < 10000000) return toWords(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + toWords(n % 100000) : '');
    return toWords(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + toWords(n % 10000000) : '');
  };

  // ── 2. Financial & Date Calculations ─────────────────────────────────────
  let totalPlantCost;
  if (lead.panelType && lead.panelType.includes('TopCon')) {
    totalPlantCost = 200000; // 2 Lakhs - TopCon Bifacial 600–620W
  } else if (lead.panelType && lead.panelType.includes('Mono PERC')) {
    totalPlantCost = 100000; // 1 Lakh - Mono PERC Half Cut Bifacial 520–550W
  } else {
    totalPlantCost = parseFloat(lead.plantCost || 0); // fallback
  }
  const taxRate = 5; // Fixed 5% GST
  const taxableValue = totalPlantCost / (1 + (taxRate / 100));
  const totalTax = totalPlantCost - taxableValue;
  const halfTax = totalTax / 2;

  const amountInWords = toWords(Math.round(totalPlantCost)) + ' Rupees Only';

  // Payment Due Date: 2 days after today
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 2);
  const formattedDueDate = dueDate.toLocaleDateString('en-IN');

  // ── 3. Render Item Row (Synthesized from Technical Specs) ───────────────
  const itemDescription = `
    Solar PV Power Plant Installation: ${lead.registeredCapacity || 'N/A'} kWp 
    (${lead.panelType || 'Standard'} Panels x ${lead.numPanels || 0} Nos) 
    Inverter: ${lead.inverterCapacity || 'N/A'}
  `.trim();

  const itemRows = `
    <tr>
      <td style="text-align:center">1</td>
      <td>
        <strong>${itemDescription}</strong><br>
        <small style="color:#555;">Structure: ${lead.structureType || 'N/A'} | Roof: ${lead.roofType || 'N/A'}</small>
      </td>
      <td style="text-align:center">8541</td>
      <td style="text-align:center">5%</td>
      <td style="text-align:center">1 Set</td>
      <td style="text-align:right">₹${taxableValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
      <td style="text-align:right">₹${taxableValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
    </tr>
  `;

  // ── 4. Final HTML Construction ──────────────────────────────────────────
  return `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; background: #f5f5f5; }
  .invoice { max-width: 900px; margin: 30px auto; padding: 24px; border: 1px solid #ccc; background: #fff; color: #222; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #ddd; }
  .company-name { font-size: 18px; font-weight: bold; margin-bottom: 4px; }
  .company-sub { font-size: 12px; color: #555; line-height: 1.7; }
  .address-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 12px; }
  .box { border: 0.5px solid #ccc; padding: 10px; border-radius: 6px; }
  .box-title { font-size: 11px; font-weight: bold; color: #666; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.4px; }
  .field { font-size: 12px; line-height: 1.5; color: #222; }
  .kv { display: flex; justify-content: space-between; font-size: 11px; padding: 2px 0; }
  .kv-label { color: #666; }
  table.items { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 12px; }
  table.items th { background: #f0f0f0; padding: 7px 8px; text-align: left; font-weight: bold; border: 0.5px solid #ccc; }
  table.items td { padding: 7px 8px; border: 0.5px solid #ccc; vertical-align: top; }
  .totals-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
  .totals-table { width: 100%; font-size: 12px; border-collapse: collapse; }
  .totals-table td { padding: 4px 6px; }
  .totals-table tr.grand td { font-weight: bold; font-size: 13px; border-top: 1px solid #aaa; padding-top: 6px; }
  .sig-row { display: flex; justify-content: space-between; margin-top: 16px; padding-top: 12px; border-top: 0.5px solid #ccc; font-size: 12px; }
</style>
</head>
<body>
<div class="invoice">
  <div class="header">
    <div>
      <div class="company-name" style="color:#cc0000;font-size:26px;">Kondaas</div>
      <div class="company-name">Kondaas Automation Pvt Ltd</div>
      <div class="company-sub">
        Registered Office: 5B, Sri Alamelu Nagar, Kamarajar Road, Coimbatore, 641015<br>
        GSTIN: 33AAACK7337F1ZR | State: Tamil Nadu
      </div>
    </div>
    <div style="text-align:right"><div style="font-size:11px; color:#777;">Original For Recipient</div></div>
  </div>

  <div class="address-row">
    <div class="box">
      <div class="box-title">Billing Address</div>
      <div class="field">
        <strong>V.S.CHANDRASEKARAN</strong><br>
             No;32 , Subramaniam Road ,,  Rs Puram, , Coimbatore,  Tamil Nadu, 641002  India<br>
        Mobile: 9940673850
      </div>
    </div>
    <div class="box">
      <div class="box-title">Delivery Address</div>
      <div class="field">
        <strong>${lead.consumerName || 'N/A'}</strong><br>
        ${lead.consumerAddress || 'N/A'}<br>
        Mobile: ${lead.mobileNumber || 'N/A'}
      </div>
    </div>
    <div class="box">
      <div class="box-title">Invoice Details</div>
      <div class="kv"><span class="kv-label">Consumer No</span> <span>${lead.consumerNumber || 'N/A'}</span></div>
      <div class="kv"><span class="kv-label">Invoice No</span> <span>${lead.invoiceNo || 'PENDING'}</span></div>
      <div class="kv"><span class="kv-label">Invoice Date</span> <span>${lead.invoiceDate || new Date().toLocaleDateString('en-IN')}</span></div>
      <div class="kv"><span class="kv-label">Due Date</span> <span>${formattedDueDate}</span></div>
      <div class="kv"><span class="kv-label">Surveyor</span> <span>${lead.siteSurveyorName || 'N/A'}</span></div>
      <div class="kv"><span class="kv-label">Surveyor Mobile</span> <span>${lead.sigDeveloperMobile || 'N/A'}</span></div>
    </div>
  </div>

  <table class="items">
    <thead>
      <tr>
        <th style="width:32px">No</th>
        <th>Description</th>
        <th style="width:70px">HSN</th>
        <th style="width:40px">Tax</th>
        <th style="width:60px">Qty</th>
        <th style="width:90px">Rate</th>
        <th style="width:90px">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
  </table>

  <div class="totals-row">
    <div>
      <div class="box" style="margin-bottom:10px">
        <div class="box-title">Amount in Words</div>
        <div class="field" style="font-weight:bold;">${amountInWords}</div>
      </div>
      <div class="box">
        <div class="box-title">Bank Details</div>
        <div class="field">TMB | A/c: 016700150950340 | IFSC: TMBL0000016</div>
      </div>
    </div>
    <div>
      <table class="totals-table">
        <tr><td>Taxable Value</td><td style="text-align:right">₹${taxableValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td></tr>
        <tr><td>SGST (2.5%)</td><td style="text-align:right">₹${halfTax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td></tr>
        <tr><td>CGST (2.5%)</td><td style="text-align:right">₹${halfTax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td></tr>
        <tr class="grand"><td>Grand Total</td><td style="text-align:right">₹${totalPlantCost.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td></tr>
      </table>
    </div>
  </div>

  <div class="sig-row">
    <div class="sig-box"><div style="font-size:12px;color:#666">QR Code Pay</div></div>
    <div class="sig-box"><div style="font-size:12px;color:#666">For Kondaas Automation Pvt Ltd</div><div style="border-top:1px solid #aaa;margin-top:40px;padding-top:4px;">Authorized Signatory</div></div>
  </div>
</div>
</body>
</html>`;
};


// RAW survey form data 
export const getSurveyReportTemplate = (formData) => {
  // Safe Fallbacks for fields to ensure nothing prints as undefined
  const d = formData || {};
  
  // Format dates cleanly
  const currentYear = new Date().getFullYear();
  const displayDate = d.date ? d.date : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const displayTime = d.time || new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  
  // Generate a mock report number matching client format based on DB id or fallback
  const reportNumber = d.deal_id ? `KON-SRV-${currentYear}-${String(d.deal_id).slice(-4).toUpperCase()}` : `KON-SRV-${currentYear}-TEMP`;

  // Helper function to color code badges for "Collected" / "Yes" status
  const getStatusBadge = (val) => {
    const cleanStr = String(val || '').trim().toLowerCase();
    if (cleanStr === 'collected' || cleanStr === 'yes' || cleanStr === 'required') {
      return `<span style="background-color: #e6f4ea; color: #137333; padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">${val}</span>`;
    }
    if (cleanStr === 'not collected' || cleanStr === 'no' || cleanStr === 'not required') {
      return `<span style="background-color: #fce8e6; color: #c5221f; padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">${val}</span>`;
    }
    return val || 'N/A';
  };

  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <title>Solar Site Survey Report</title>
    <style>
      @page {
        size: A4;
        margin: 15mm 15mm 20mm 15mm;
      }
      body {
        font-family: 'Segoe UI', Helvetica, Arial, sans-serif;
        color: #333;
        margin: 0;
        padding: 0;
        font-size: 12px;
        line-height: 1.4;
        background-color: #fff;
      }
      
      /* Header Branded Section */
      .header-container {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        border-bottom: 3px solid #e31e24; /* Kondaas Red Accent */
        padding-bottom: 10px;
        margin-bottom: 20px;
      }
      .brand-title-group h1 {
        color: #e31e24;
        font-size: 24px;
        margin: 0;
        font-weight: 800;
        letter-spacing: 0.5px;
      }
      .brand-title-group p {
        margin: 2px 0 0 0;
        font-size: 11px;
        text-transform: uppercase;
        color: #666;
        letter-spacing: 1px;
        font-weight: 600;
      }
      .pricing-notice {
        font-size: 10px;
        color: #777;
        font-style: italic;
        text-align: right;
        margin-top: 5px;
      }

      /* Station Metadata Tracker Grid */
      .meta-tracker-table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 20px;
      }
      .meta-tracker-table th {
        background-color: #2c3e50;
        color: #fff;
        font-weight: 600;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        padding: 6px 10px;
        border: 1px solid #2c3e50;
        text-align: left;
      }
      .meta-tracker-table td {
        padding: 6px 10px;
        border: 1px solid #ddd;
        font-weight: bold;
        color: #2c3e50;
        background-color: #f8f9fa;
      }

      /* Section Layout Styling */
      .section-block {
        margin-bottom: 20px;
        page-break-inside: avoid;
      }
      .section-title {
        background-color: #f1f3f4;
        color: #1a73e8;
        font-size: 12px;
        font-weight: bold;
        padding: 6px 10px;
        margin: 0 0 8px 0;
        border-left: 4px solid #1a73e8;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      /* Dynamic Standard Core Grid Base */
      .data-table {
        width: 100%;
        border-collapse: collapse;
      }
      .data-table td {
        padding: 7px 10px;
        border: 1px solid #e0e0e0;
        vertical-align: top;
        width: 25%;
      }
      .data-table td.label {
        font-weight: 600;
        color: #5f6368;
        background-color: #f8f9fa;
        width: 25%;
      }
      .data-table td.value {
        color: #202124;
        width: 25%;
      }

      /* Document Checklist Special Grids */
      .checklist-table {
        width: 100%;
        border-collapse: collapse;
      }
      .checklist-table td {
        padding: 6px 10px;
        border: 1px solid #e0e0e0;
        width: 25%;
      }
      .checklist-table td.label {
        color: #444;
        background-color: #fafafa;
      }

      /* Pricing Total Callout Blocks */
      .pricing-highlight {
        background-color: #f8f9fa;
        border: 1px solid #dadce0;
        padding: 12px;
        border-radius: 4px;
        margin-top: 5px;
      }
      .pricing-row {
        display: flex;
        justify-content: space-between;
        padding: 4px 0;
        font-size: 12px;
      }
      .pricing-row.total {
        border-top: 1px solid #ccc;
        margin-top: 6px;
        padding-top: 6px;
        font-size: 14px;
        font-weight: bold;
        color: #e31e24;
      }

      /* Signature Board Matrix */
      .signature-container {
        display: flex;
        justify-content: space-between;
        margin-top: 30px;
        page-break-inside: avoid;
      }
      .signature-box {
        width: 45%;
        border-top: 1px dashed #999;
        text-align: center;
        padding-top: 8px;
        font-size: 11px;
        color: #5f6368;
      }
      .sig-space {
        height: 40px;
        font-family: 'Courier New', Courier, monospace;
        font-style: italic;
        font-size: 16px;
        color: #1a73e8;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      /* Footer Layout Markers */
      .footer-note {
        text-align: center;
        font-size: 10px;
        color: #999;
        margin-top: 30px;
        border-top: 1px solid #eee;
        padding-top: 5px;
      }
    </style>
  </head>
  <body>

    <div class="header-container">
      <div class="brand-title-group">
        <h1>KONDAAS</h1>
        <p>Rooftop Solar Site Survey & Technical Report</p>
      </div>
      <div>
        <div style="font-weight: bold; color: #e31e24; font-size: 14px; text-align: right;">OFFICIAL SURVEY REPORT</div>
        <div class="pricing-notice">* Pricing valid for 7 days from survey completion date.</div>
      </div>
    </div>

    <table class="meta-tracker-table">
      <thead>
        <tr>
          <th>Report Number</th>
          <th>Survey Date</th>
          <th>Survey Time</th>
          <th>GPS Link</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${reportNumber}</td>
          <td>${displayDate}</td>
          <td>${displayTime}</td>
          <td><a href="${d.googleMapLink || '#'}" style="color: #1a73e8; text-decoration: none;">Click to View Map</a></td>
        </tr>
      </tbody>
    </table>

    <div class="section-block">
      <div class="section-title">1. Customer & Surveyor Profiles</div>
      <table class="data-table">
        <tr>
          <td class="label">Customer Name</td>
          <td class="value">${d.clientName || 'N/A'}</td>
          <td class="label">Site Engineer</td>
          <td class="value">${d.engineerName || 'N/A'}</td>
        </tr>
        <tr>
          <td class="label">Customer Contact</td>
          <td class="value">${d.clientContact || 'N/A'}</td>
          <td class="label">Engineer Contact</td>
          <td class="value">${d.engineerContact || 'N/A'}</td>
        </tr>
        <tr>
          <td class="label">Site Coordinates</td>
          <td class="value" colspan="3">
            Lat: ${d.latitude || 'N/A'}, Lng: ${d.longitude || 'N/A'} 
            ${d.gpsAccuracy ? `(Accuracy: ${d.gpsAccuracy}m)` : ''}
          </td>
        </tr>
        <tr>
          <td class="label">Site Address</td>
          <td class="value" colspan="3">${d.siteAddress || 'N/A'}</td>
        </tr>
      </table>
    </div>

    <div class="section-block">
      <div class="section-title">2. Administrative & Design Parameters</div>
      <table class="data-table">
        <tr>
          <td class="label">Order Type</td>
          <td class="value">${d.orderType || 'N/A'}</td>
          <td class="label">Project Type</td>
          <td class="value">${d.projectType || 'N/A'}</td>
        </tr>
        ${d.telecallerName ? `
        <tr>
          <td class="label">Telecaller Name</td>
          <td class="value" colspan="3">${d.telecallerName}</td>
        </tr>` : ''}
      </table>
    </div>

    <div class="section-block">
      <div class="section-title">3. Electrical Connection Metadata</div>
      <table class="data-table">
        <tr>
          <td class="label">Consumer Number</td>
          <td class="value">${d.consumerNumber || 'N/A'}</td>
          <td class="label">Consumer Name</td>
          <td class="value">${d.consumerName || 'N/A'}</td>
        </tr>
        <tr>
          <td class="label">Connection Status</td>
          <td class="value">${d.connectionStatus || 'N/A'}</td>
          <td class="label">Tariff Type</td>
          <td class="value">${d.tariffType || 'N/A'}</td>
        </tr>
        <tr>
          <td class="label">Connection Phase</td>
          <td class="value">${d.connectionPhase || 'N/A'}</td>
          <td class="label">Connected Load</td>
          <td class="value">${d.connectedLoad ? d.connectedLoad + ' kW' : 'N/A'}</td>
        </tr>
        <tr>
          <td class="label">KSEB Conn Under Contact?</td>
          <td class="value">${getStatusBadge(d.ksebConnectionUnderContactPerson)}</td>
          <td class="label">Transformer Capacity</td>
          <td class="value">${d.balanceTransformerCapacity || 'N/A'}</td>
        </tr>
      </table>
    </div>

    <div class="section-block">
      <div class="section-title">4. Primary Technology Preferences</div>
      <table class="data-table">
        <tr>
          <td class="label">Inverter Type</td>
          <td class="value">${d.inverterType || 'N/A'}</td>
          <td class="label">Inv. Connection</td>
          <td class="value">${d.inverterConnectionType || 'N/A'}</td>
        </tr>
        <tr>
          <td class="label">Inverter Capacity</td>
          <td class="value">${d.inverterCapacity ? d.inverterCapacity + ' kW' : 'N/A'}</td>
          <td class="label">Solar Panel Type</td>
          <td class="value">${d.panelType || 'N/A'}</td>
        </tr>
        <tr>
          <td class="label">Number of Panels</td>
          <td class="value" colspan="3">${d.numberOfPanels ? d.numberOfPanels + ' Qty' : 'N/A'}</td>
        </tr>
      </table>
    </div>

    <div class="section-block">
      <div class="section-title">5. Structural & Roof Feasibilities</div>
      <table class="data-table">
        <tr>
          <td class="label">North to South Space</td>
          <td class="value">${d.spaceNorthSouth ? d.spaceNorthSouth + ' meters' : 'N/A'}</td>
          <td class="label">East to West Space</td>
          <td class="value">${d.spaceEastWest ? d.spaceEastWest + ' meters' : 'N/A'}</td>
        </tr>
        <tr>
          <td class="label">Structure Type</td>
          <td class="value">${d.structureType || 'N/A'}</td>
          <td class="label">Roof Type</td>
          <td class="value">${d.roofType || 'N/A'}</td>
        </tr>
        <tr>
          <td class="label">Roof Condition</td>
          <td class="value">${d.roofCondition || 'N/A'}</td>
          <td class="label">Building Height Profile</td>
          <td class="value">${d.buildingHeight || 'N/A'}</td>
        </tr>
        <tr>
          <td class="label">Shadow Possibility</td>
          <td class="value">${getStatusBadge(d.shadowPossibility)}</td>
          <td class="label">Roof Access Available?</td>
          <td class="value">${getStatusBadge(d.roofAccess)}</td>
        </tr>
        <tr>
          <td class="label">Ladder Requirement</td>
          <td class="value">${getStatusBadge(d.ladderRequirement)}</td>
          <td class="label">Safety Walkway Req.</td>
          <td class="value">${getStatusBadge(d.walkwayRequirement)}</td>
        </tr>
        <tr>
          <td class="label">Sliding Door Setup</td>
          <td class="value" colspan="3">${getStatusBadge(d.slidingDoorRequirement)}</td>
        </tr>
      </table>
    </div>

    <div class="section-block">
      <div class="section-title">6. Detailed Cabling Feasibility Structure</div>
      <div style="border: 1px solid #e0e0e0; padding: 10px; background-color: #fdfdfd;">
        <strong>Cable Scope Assignment:</strong> ${d.cableRequirement || 'Standard BOM Cables Only'}<br>
        <span style="color: #666; font-size: 11px; margin-top: 4px; display: inline-block;">
          The site cabling system has been routed according to engineering standards. Any additional cabling variants required beyond standard parameters will layout dynamically during installation.
        </span>
      </div>
    </div>

    <div class="section-block">
      <div class="section-title">7. Client Checklist Summary Status</div>
      <table class="data-table">
        <tr>
          <td class="label">Customer Docs Checked</td>
          <td class="value">${d.customerDocsProvided || 'N/A'}</td>
          <td class="label">Documents Status</td>
          <td class="value">${d.documentsCollectedStatus || 'N/A'}</td>
        </tr>
        <tr>
          <td class="label">Collected Site Photos</td>
          <td class="value">${getStatusBadge(d.collectedSitePhotosStatus)}</td>
          <td class="label">EB Bill Name Change?</td>
          <td class="value">${getStatusBadge(d.ksebNameChange)}</td>
        </tr>
        <tr>
          <td class="label">Bank Name Correction?</td>
          <td class="value">${getStatusBadge(d.bankNameChange)}</td>
          <td class="label">KSEB Connected Load Change?</td>
          <td class="value">${getStatusBadge(d.gridLoadChange)}</td>
        </tr>
      </table>
    </div>

    <div class="section-block">
      <div class="section-title">8. Detailed Document & Photo Verification Checklists</div>
      <table class="checklist-table">
        <tr>
          <td class="label">North to South View Photo</td>
          <td>${getStatusBadge(d.photoNorthSouth)}</td>
          <td class="label">South to North View Photo</td>
          <td>${getStatusBadge(d.photoSouthNorth)}</td>
        </tr>
        <tr>
          <td class="label">East to West View Photo</td>
          <td>${getStatusBadge(d.photoEastWest)}</td>
          <td class="label">West to East View Photos</td>
          <td>${getStatusBadge(d.photoWestEast)}</td>
        </tr>
        <tr>
          <td class="label">Panel Mounting Location</td>
          <td>${getStatusBadge(d.photoPanelMounting)}</td>
          <td class="label">Geo Tagged Roof Photo</td>
          <td>${getStatusBadge(d.photoGeoTagged)}</td>
        </tr>
        <tr>
          <td class="label">Roof Videos</td>
          <td>${getStatusBadge(d.videoRoof)}</td>
          <td class="label">Roof Surround Videos</td>
          <td>${getStatusBadge(d.videoSurround)}</td>
        </tr>
        <tr>
          <td class="label">Building Full View Photo</td>
          <td>${getStatusBadge(d.photoBuildingView)}</td>
          <td class="label">KSEB Meter Photo</td>
          <td>${getStatusBadge(d.photoMeter)}</td>
        </tr>
        <tr>
          <td class="label">Earthing Location Photo</td>
          <td>${getStatusBadge(d.photoEarthing)}</td>
          <td class="label">Inverter / DB Location</td>
          <td>${getStatusBadge(d.photoInverterDb)}</td>
        </tr>
      </table>
    </div>

    <div class="section-block">
      <div class="section-title">9. Commercial Pricing & Payments Matrix</div>
      <table class="data-table" style="margin-bottom: 5px;">
        <tr>
          <td class="label">Mode of Payment</td>
          <td class="value"><strong>${d.paymentMode || 'N/A'}</strong></td>
          <td class="label">Advance Booking Collected</td>
          <td class="value">${getStatusBadge(d.advanceCollectionStatus)}</td>
        </tr>
        <tr>
          <td class="label">Product / Package Name</td>
          <td class="value" colspan="3"><strong>${d.productName || 'N/A'}</strong></td>
        </tr>
      </table>
      
      <div class="pricing-highlight">
        <div class="pricing-row">
          <span>Total Plant Cost (System Standard Setup):</span>
          <span>₹${Number(d.totalPlantCost || 0).toLocaleString('en-IN')}</span>
        </div>
        <div class="pricing-row" style="color: #c5221f;">
          <span>Government Subsidy Discount (-):</span>
          <span>- ₹${Number(d.governmentSubsidy || 0).toLocaleString('en-IN')}</span>
        </div>
        <div class="pricing-row">
          <span>Additional KSEB Charges:</span>
          <span>₹${Number(d.additionalKsebCharges || 0).toLocaleString('en-IN')}</span>
        </div>
        <div class="pricing-row">
          <span>Additional Structure/Customization Charges:</span>
          <span>₹${Number(d.additionalStructureCost || 0).toLocaleString('en-IN')}</span>
        </div>
        <div class="pricing-row total">
          <span>Calculated Cost After Subsidy (Net Due):</span>
          <span>₹${Number(d.netCostAfterSubsidy || (Number(d.totalPlantCost || 0) - Number(d.governmentSubsidy || 0) + Number(d.additionalKsebCharges || 0) + Number(d.additionalStructureCost || 0))).toLocaleString('en-IN')}</span>
        </div>
      </div>
    </div>

    <div class="section-block">
      <div class="section-title">10. Field Observations & Technical Remarks</div>
      <div style="border: 1px solid #dadce0; padding: 12px; min-height: 40px; background-color: #fdfdfd; font-size: 11px; white-space: pre-line;">
        ${d.remarks || 'No critical installation risks noted at the time of site survey evaluation.'}
      </div>
    </div>

    <div class="signature-container">
      <div class="signature-box">
        <div class="sig-space">${d.siteEngineerSignature ? `<img src="${d.siteEngineerSignature}" style="max-height: 35px;" />` : d.engineerName || 'Praveen Kumar'}</div>
        <strong>SITE ENGINEER SIGNATURE</strong><br>
        <span style="font-size: 9px; color:#888;">Date: ${displayDate} | Time: ${displayTime}</span>
      </div>
      <div class="signature-box">
        <div class="sig-space">${d.customerConfirmationSignature ? `<img src="${d.customerConfirmationSignature}" style="max-height: 35px;" />` : d.clientName || 'Authorized Signatory'}</div>
        <strong>CUSTOMER CONFIRMATION SIGNATURE</strong><br>
        <span style="font-size: 9px; color:#888;">Kondaas Automation Authorization Signature</span>
      </div>
    </div>

    <div class="footer-note">
      Report Generated Automatically via Kondaas Site Survey Operations Engine. Page 1 of 1
    </div>

  </body>
  </html>
  `;
};
