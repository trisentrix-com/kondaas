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