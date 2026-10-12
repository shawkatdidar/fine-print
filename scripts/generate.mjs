// Generates the three fictional agreements into documents/.
// Run: node scripts/generate.mjs
// Each page starts with a marker like [[P037]] so SubQ can point at a page.
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { presets, presetOrder } from '../lib/presets.mjs';
import { generic, topics } from './vocab.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'documents');

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const ones = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const words = (n) => n < 20 ? ones[n] : n < 100 ? tens[Math.floor(n / 10)] + (n % 10 ? '-' + ones[n % 10] : '') : String(n);

// ---------- Document outlines ----------
const outlines = {
  supply: {
    body: [
      ['definitions', 'Definitions and Interpretation', 0], ['scope', 'Scope and Appointment', 4], ['ordering', 'Ordering', 5], ['forecasts', 'Forecasts and Commitments', 4],
      ['payment', 'Pricing, Invoicing and Payment', 5], ['delivery', 'Delivery', 5], ['packaging', 'Packaging and Labeling', 3], ['inspection', 'Inspection and Acceptance', 4],
      ['quality', 'Quality', 4], ['warranty', 'Warranties', 4], ['tooling', 'Tooling', 4], ['ip', 'Intellectual Property', 4], ['confidentiality', 'Confidentiality', 4],
      ['compliance', 'Compliance with Laws', 4], ['insurance', 'Insurance', 3], ['indemnity', 'Indemnification', 4], ['liability', 'Limitation of Liability', 3],
      ['term', 'Term and Termination', 5], ['forcemajeure', 'Force Majeure', 3], ['audit', 'Records and Audit', 3], ['disputes', 'Dispute Resolution', 3],
      ['assignment', 'Assignment and Subcontracting', 2], ['notices', 'Notices', 2], ['general', 'General Provisions', 5],
    ],
    exhibits: [
      ['exhibit:specs', 'Exhibit A. Product Specifications', 'specs', 5], ['exhibit:pricing', 'Exhibit B. Price Schedule', 'pricing', 2], ['exhibit:quality', 'Exhibit C. Quality Requirements', 'prose:quality,inspection', 2],
      ['exhibit:logistics', 'Exhibit D. Logistics and Facilities', 'lanes', 3], ['exhibit:kpi', 'Exhibit E. Service Levels', 'kpi', 1.5], ['exhibit:conduct', 'Exhibit F. Supplier Code of Conduct', 'prose:compliance,confidentiality', 1.5],
      ['exhibit:data', 'Exhibit G. Data Practices', 'prose:confidentiality,compliance', 1], ['exhibit:change', 'Exhibit H. Change Control Procedure', 'prose:ordering,quality,scope', 1.2],
    ],
  },
  lease: {
    body: [
      ['definitions', 'Definitions', 0], ['premises', 'Premises', 4], ['leaseterm', 'Term', 3], ['rent', 'Base Rent', 4], ['opex', 'Operating Expenses and Taxes', 5], ['deposit', 'Security Deposit', 2],
      ['use', 'Use', 5], ['services', 'Services and Utilities', 3], ['maintenance', 'Maintenance and Repairs', 4], ['alterations', 'Alterations', 4], ['access', 'Access', 3],
      ['insurance', 'Insurance', 4], ['indemnity', 'Indemnity', 3], ['casualty', 'Damage and Destruction', 4], ['condemnation', 'Condemnation', 2], ['assignment', 'Assignment and Subletting', 3],
      ['default', 'Default and Remedies', 5], ['surrender', 'Surrender and Holding Over', 3], ['subordination', 'Subordination and Estoppel', 3], ['environmental', 'Hazardous Materials', 3],
      ['signage', 'Signage', 2], ['forcemajeure', 'Force Majeure', 2], ['notices', 'Notices', 2], ['general', 'Miscellaneous', 5],
    ],
    exhibits: [
      ['exhibit:legal', 'Exhibit A. Legal Description of the Land', 'metes', 1.6], ['exhibit:rent', 'Exhibit B. Rent Schedule', 'rentschedule', 0.4], ['exhibit:work', 'Exhibit C. Work Letter', 'prose:alterations,maintenance,premises', 2.2],
      ['exhibit:rules', 'Exhibit D. Rules and Regulations', 'rules', 2.4], ['exhibit:sign', 'Exhibit E. Signage Criteria', 'prose:signage,use', 0.8], ['exhibit:guaranty', 'Exhibit F. Guaranty of Lease', 'prose:default,indemnity', 0.9],
      ['exhibit:opexx', 'Exhibit G. Operating Expense Exclusions', 'opexx', 0.6], ['exhibit:services', 'Exhibit H. Building Services Specifications', 'prose:services,maintenance,environmental', 1.5],
    ],
  },
  terms: {
    body: [
      ['acceptance', 'Welcome to Mossbook', 3], ['definitions', 'Definitions', 0], ['account', 'Your Account', 4], ['service', 'The Service', 4], ['content', 'Your Content', 5],
      ['features', 'Features', 5], ['acceptableuse', 'Acceptable Use', 4], ['ip', 'Our Intellectual Property', 3], ['thirdparty', 'Third-Party Services', 3], ['communications', 'Communications', 3],
      ['changes', 'Changes to the Service and These Terms', 3], ['termination', 'Suspension and Termination', 4], ['disclaimers', 'Disclaimers', 3], ['liability', 'Limitation of Liability', 3],
      ['indemnity', 'Indemnity', 2], ['disputes', 'Governing Law', 2], ['general', 'General', 4],
    ],
    exhibits: [
      ['exhibit:billing', 'Exhibit A. Subscription and Billing Terms', 'prose:billing,payment', 2], ['exhibit:privacy', 'Exhibit B. Privacy Notice', 'prose:privacy,communications,account', 3],
      ['exhibit:arbitration', 'Exhibit C. Dispute Resolution Procedures', 'prose:arbitration,disputes', 1.4], ['exhibit:features', 'Exhibit D. Service-Specific Terms', 'tosfeatures', 3],
      ['exhibit:countries', 'Exhibit E. Country-Specific Terms', 'countries', 3.2], ['exhibit:processors', 'Exhibit F. Subprocessors', 'processors', 1.4], ['exhibit:guidelines', 'Exhibit G. Community Guidelines', 'guidelines', 2],
    ],
  },
};

// ---------- Definitions ----------
const definitions = {
  supply: [
    ['Affiliate', 'any entity that directly or indirectly controls, is controlled by, or is under common control with a Party, where "control" means ownership of more than fifty percent (50%) of the voting interests'],
    ['Annual Volume Commitment', 'the quantity of Products identified as such in Exhibit B for each Contract Year'], ['Business Day', 'any day other than a Saturday, Sunday or public holiday in the State of Ohio'],
    ['Contract Year', 'each period of twelve (12) months beginning on the Effective Date or an anniversary of it'], ['Effective Date', 'the date on which this Agreement has been signed by both Parties'],
    ['Forecast', 'a non-binding estimate of the quantities of Products that Purchaser expects to order, provided under Article 4'], ['Good Industry Practice', 'the degree of skill, care and foresight reasonably expected of a skilled and experienced manufacturer of similar goods'],
    ['Intellectual Property Rights', 'patents, designs, copyrights, trade secrets, trademarks and all similar rights anywhere in the world'], ['Initial Term', 'the period described in Section 18.1'],
    ['Products', 'the goods described in Exhibit A, as amended from time to time through the change control procedure'], ['Purchase Order', 'a written or electronic order for Products issued by Purchaser under this Agreement'],
    ['Purchaser Data', 'all data and information relating to Purchaser, its customers or its business that Supplier receives or generates in connection with this Agreement'],
    ['Relationship Manager', 'the individual appointed by each Party under Section 2.3'], ['Specifications', 'the drawings, standards and requirements for each Product set out or referenced in Exhibit A'],
    ['Supplier Portal', 'the web-based system operated by Supplier for the exchange of orders, invoices and documents'], ['Term', 'the Initial Term together with any renewal or extension'],
    ['Tooling', 'all molds, dies, fixtures, gauges and other tools used to manufacture the Products'], ['Unit Price', 'the price per unit of each Product set out in Exhibit B'],
    ['Force Majeure Event', 'an event beyond the reasonable control of the affected Party, including natural disaster, war, epidemic and governmental action'],
    ['Confidential Information', 'all non-public information disclosed by one Party to the other in connection with this Agreement, in any form'],
  ],
  lease: [
    ['Additional Rent', 'all amounts other than Base Rent payable by Tenant under this Lease'], ['Base Rent', 'the monthly rent set out in Exhibit B'], ['Business Day', 'any day other than a Saturday, Sunday or legal holiday in the City'],
    ['Common Areas', 'the walkways, parking areas, landscaping and other areas of the Project available for the common use of tenants'], ['Commencement Date', 'the date determined under Section 4.2'],
    ['Lease Year', 'each period of twelve (12) consecutive full calendar months beginning on the Commencement Date'], ['Operating Expenses', 'the costs of operating, maintaining and insuring the Project, subject to the exclusions in Exhibit G'],
    ['Permitted Use', 'the use described in Section 8.1'], ['Premises', 'the space known as Unit 4, Calder Street Market Hall, shown on Exhibit C'], ['Project', 'the land described in Exhibit A and the buildings and improvements on it'],
    ['Proportionate Share', 'the percentage stated in Section 6.3'], ['Security Deposit', 'the amount described in Article 7'], ['Term', 'the period described in Article 4, including any renewal'],
    ['Alteration', 'any alteration, addition or improvement to the Premises'], ['Hazardous Material', 'any substance regulated as hazardous or toxic under applicable environmental law'],
    ['Guarantor', 'each person who signs the Guaranty attached as Exhibit F'], ['Event of Default', 'any of the events described in Section 18.1'],
  ],
  terms: [
    ['App', 'the Mossbook mobile and desktop applications'], ['Content', 'the entries, photographs, captions, albums and other material you upload to the Service'], ['Mossbook', 'Mossbook Labs, Inc. and, where the context requires, its Affiliates'],
    ['Personal Information', 'information that identifies you or could reasonably be linked to you'], ['Service', 'the App, the website and all related services provided by Mossbook'],
    ['Subscription', 'a paid plan that gives you additional storage or features'], ['Shared Album', 'an album that you have chosen to share with other people'], ['Affiliates', 'companies that control, are controlled by or are under common control with Mossbook'],
    ['Community Guidelines', 'the rules in Exhibit G'], ['Memories', 'the feature described in Section 6.2'],
  ],
};

// ---------- List-style exhibit generators ----------
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const pick2 = (r, arr) => { const a = pick(r, arr); let b = pick(r, arr); for (let k = 0; b === a && k < 8; k++) b = pick(r, arr); return b === a ? a : `${a} ${b}`; };
const listGen = {
  specs(r, ctx) {
    const comp = ['machined housing', 'bearing carrier', 'mounting bracket', 'drive shaft', 'valve body', 'heat sink', 'cover plate', 'gear blank', 'sensor mount', 'manifold block', 'spacer ring', 'hinge arm', 'end cap', 'pivot pin', 'motor flange', 'clamp collar', 'pump impeller', 'rail carriage', 'latch plate', 'bushing sleeve', 'fan hub', 'enclosure lid', 'caster yoke', 'cam follower'];
    const mat = ['6061-T6 aluminum', '7075-T651 aluminum', '304 stainless steel', '316L stainless steel', '1018 cold-rolled steel', '4140 alloy steel, heat treated to 28-32 HRC', 'C360 brass', 'glass-filled nylon 6/6', 'acetal copolymer', 'ductile iron 65-45-12', 'PEEK', 'zinc alloy ZA-8'];
    const fin = ['clear anodize Type II', 'black anodize Type II', 'hard anodize Type III', 'passivated per ASTM A967', 'zinc-nickel plate with clear trivalent passivate', 'black oxide with oil', 'powder coat, textured black', 'electroless nickel, 0.0005 in. thick', 'bead blast and passivate', 'as machined, deburred'];
    const notes = ['Critical dimensions identified on drawing shall be measured on every part.', 'Thread gauges shall be verified at the start of each shift.', 'Surface finish shall not exceed Ra 1.6 µm on sealing faces.', 'Parts shall be free of burrs, chips and cutting fluid residue.', 'Hardness shall be verified on one part per heat lot.', 'Cosmetic surfaces shall be free of scratches visible at arm\'s length.', 'Flatness of the mounting face shall be within 0.05 mm.', 'Each lot shall be accompanied by a material certificate.', 'Coating thickness shall be measured on five parts per lot.', 'Parts shall be bagged individually to protect cosmetic faces.'];
    const n = 4100 + Math.floor(r() * 5800);
    return `Part No. NV-${n}-${'ABCDEFGHJK'[Math.floor(r() * 10)]}. ${cap(pick(r, comp))} in ${pick(r, mat)}, finish ${pick(r, fin)}. Overall dimensions ${(20 + r() * 240).toFixed(1)} × ${(10 + r() * 140).toFixed(1)} × ${(3 + r() * 60).toFixed(1)} mm; general tolerance ±${pick(r, ['0.02', '0.05', '0.10', '0.15', '0.25'])} mm; nominal weight ${Math.round(8 + r() * 2400)} g. Standard pack: ${pick(r, [10, 20, 25, 50, 100, 200, 250])} units per ${pick(r, ['corrugated carton', 'returnable tote', 'divided tray', 'foam-lined case'])}. Lead time ${pick(r, [4, 5, 6, 8, 10, 12])} weeks from release. ${pick2(r, notes)}`;
  },
  pricing(r) {
    const n = 4100 + Math.floor(r() * 5800);
    const base = 2 + r() * 180;
    return `NV-${n}-${'ABCDEFGHJK'[Math.floor(r() * 10)]}: $${base.toFixed(2)} per unit for releases of 1 to 499 units; $${(base * 0.93).toFixed(2)} for 500 to 1,999 units; $${(base * 0.87).toFixed(2)} for 2,000 units or more. Annual Volume Commitment: ${(Math.round(r() * 40) * 500 + 1000).toLocaleString('en-US')} units. Tooling amortization: ${r() < 0.5 ? 'none' : `$${(r() * 3).toFixed(2)} per unit until ${(Math.round(r() * 20) * 1000 + 5000).toLocaleString('en-US')} units have been invoiced`}.`;
  },
  lanes(r, ctx) {
    ctx.lane = (ctx.lane || 0) + 1;
    const origin = ['Supplier Plant 1, 4410 Kessler Road, Fairborn, Ohio', 'Supplier Plant 2, 88 Industrial Parkway, Muncie, Indiana', 'Supplier Plant 3, 1200 Tanager Drive, Elkhart, Indiana', 'Supplier Warehouse, 640 Commerce Court, Columbus, Ohio'];
    const dest = ['Purchaser Assembly, 22 Foundry Lane, Reno, Nevada', 'Purchaser Distribution Center, 905 Larkspur Way, Joliet, Illinois', 'Purchaser Service Depot, 17 Oriole Street, Greenville, South Carolina', 'Purchaser Assembly, 3300 Mesa Ridge Road, Tempe, Arizona', 'Purchaser Repair Center, 410 Birchwood Avenue, Grand Rapids, Michigan'];
    const carrier = ['Ridgeline Freight', 'Bluestem Logistics', 'Tamarack Carriers', 'Orchard Line Transport', 'Copperleaf Express', 'Halyard Motor Freight'];
    const mode = ['full truckload, dry van', 'less-than-truckload', 'dedicated milk run', 'parcel, ground service', 'intermodal rail and dray'];
    const instr = ['Call ahead two hours before arrival.', 'Deliveries accepted at dock doors 3 through 6 only.', 'Drivers must wear high-visibility vests on site.', 'No deliveries on the last Business Day of each quarter.', 'Pallets must be shrink-wrapped and corner-boarded.', 'Appointment required through the receiving scheduler.', 'Seal numbers must appear on the bill of lading.'];
    return `Lane ${ctx.lane}. From ${pick(r, origin)} to ${pick(r, dest)}. Mode: ${pick(r, mode)}. Designated carrier: ${pick(r, carrier)}. Planned transit time: ${1 + Math.floor(r() * 6)} days. Receiving hours: ${pick(r, ['6:00 a.m. to 2:00 p.m.', '7:00 a.m. to 3:30 p.m.', '8:00 a.m. to 4:00 p.m.', '5:30 a.m. to 1:30 p.m.'])} local time, Monday to Friday. ${pick2(r, instr)}`;
  },
  kpi(r, ctx) {
    ctx.kpi = (ctx.kpi || 0) + 1;
    const k = pick(r, ['On-time delivery, measured against the confirmed delivery date', 'Quality acceptance rate, measured in defective parts per million', 'Order acknowledgment within the required time', 'Invoice accuracy', 'Corrective action closure within thirty (30) days', 'Advance shipping notice accuracy', 'Response time to engineering queries', 'Packaging compliance', 'Certificate of conformance completeness', 'Forecast response within five (5) Business Days']);
    return `Service Level ${ctx.kpi}. ${k}. Target: ${pick(r, ['98%', '99%', '99.5%', '97%', '95%', 'no more than 250 ppm', 'no more than 100 ppm'])}. Measured ${pick(r, ['monthly', 'quarterly', 'on a rolling three-month basis'])} and reported at the review meeting. If the target is missed in ${pick(r, ['two', 'three'])} consecutive periods, Supplier shall deliver an improvement plan within ${pick(r, ['ten (10)', 'fifteen (15)', 'twenty (20)'])} Business Days.`;
  },
  metes(r, ctx) {
    ctx.course = (ctx.course || 0) + 1;
    const d = () => `${pick(r, ['North', 'South'])} ${Math.floor(r() * 89)}°${String(Math.floor(r() * 60)).padStart(2, '0')}'${String(Math.floor(r() * 60)).padStart(2, '0')}" ${pick(r, ['East', 'West'])}`;
    const along = ['along the southerly right-of-way line of Calder Street', 'along the westerly line of Lot 14 of Harwick\'s Addition', 'along the centerline of a vacated alley', 'along the northerly line of the Ferris Creek drainage easement', 'along a line parallel with and 20.00 feet distant from the east line of said Lot 9', 'along the arc of a curve concave to the northwest having a radius of 412.50 feet', 'along the boundary of the parcel conveyed by deed recorded as Document No. ' + (1000000 + Math.floor(r() * 8999999))];
    return `Course ${ctx.course}: thence ${d()}, a distance of ${(10 + r() * 380).toFixed(2)} feet ${pick(r, along)}, to ${pick(r, ['an iron pin found', 'a 5/8-inch rebar with cap set', 'a point', 'a cut cross in concrete', 'a monument found'])};`;
  },
  rentschedule(r, ctx) {
    ctx.ly = (ctx.ly || 0) + 1;
    const base = 4260 * Math.pow(1.025, ctx.ly - 1);
    if (ctx.ly > 15) return null;
    if (ctx.ly > 10) return `Renewal Lease Year ${ctx.ly - 10} (if the renewal option is exercised): Base Rent of ${money(base)} per month, being the Base Rent for the preceding Lease Year increased by two and one-half percent (2.5%).`;
    return `Lease Year ${ctx.ly}: Base Rent of ${money(base)} per month (${money(base * 12)} per year), equal to ${money(base * 12 / 1420)} per rentable square foot per year.`;
  },
  rules(r, ctx) {
    ctx.rule = (ctx.rule || 0) + 1;
    const s = pick(r, ['Tenant', 'No tenant', 'Tenant\'s employees', 'Tenant\'s contractors', 'Delivery vehicles', 'Vendors serving the Premises']);
    const neg = s.startsWith('No') ? '' : 'shall not ';
    const act = pick(r, ['park in spaces marked for customer use', 'leave refuse outside the designated enclosure', 'prop open the fire doors at the rear of the building', 'use the Common Area restrooms for washing equipment', 'play amplified music audible outside the Premises', 'store goods in the service corridor', 'affix anything to the exterior walls', 'idle engines in the loading zone for more than five minutes', 'bring animals into the building, other than service animals', 'place furniture on the sidewalk without a permit', 'install window coverings other than those approved by Landlord', 'pour grease or oil into any drain', 'use the freight elevator during the hours of 11:00 a.m. to 2:00 p.m.', 'operate any open-flame cooking equipment without a hood and suppression system', 'distribute flyers in the parking areas', 'sleep or lodge in the Premises']);
    const tail = pick(r, ['', ' at any time', ' except with Landlord\'s prior written approval', ' between the hours of 10:00 p.m. and 6:00 a.m.', ' during the holiday season from November 15 to January 5', ' in any manner that disturbs other tenants']);
    return `Rule ${ctx.rule}. ${s} ${s.startsWith('No') ? 'shall ' : neg}${act}${tail}.${r() < 0.4 ? ' ' + pick(r, ['Landlord may amend this rule on thirty (30) days\' notice to all tenants, provided the amendment applies to all tenants equally.', 'Repeated violations may be addressed at the quarterly tenant meeting.', 'This rule is intended for the safety of all occupants.', 'Landlord shall enforce this rule in a non-discriminatory manner.']) : ''}`;
  },
  opexx(r, ctx) {
    const items = ['costs of leasing commissions and advertising for vacant space', 'depreciation of the buildings', 'interest and principal on any mortgage', 'costs of correcting construction defects', 'costs reimbursed by insurance', 'salaries of executives above the level of property manager', 'costs of repairing damage caused by a casualty', 'charitable or political contributions', 'costs of acquiring artwork', 'fines and penalties incurred by Landlord', 'costs of disputes with other tenants', 'management fees exceeding three percent (3%) of gross receipts', 'costs of remediating Hazardous Materials', 'ground rent', 'costs incurred to sell or refinance the Project', 'costs of services provided to other tenants but not to Tenant', 'reserves for future expenses', 'income and franchise taxes of Landlord', 'costs of structural repairs', 'costs of capital improvements'];
    ctx.ox = (ctx.ox || 0);
    if (ctx.ox >= items.length) return null;
    return `Exclusion ${ctx.ox + 1}. Operating Expenses shall not include ${items[ctx.ox++]}.`;
  },
  tosfeatures(r, ctx) {
    const feats = [
      ['Memories', 'Memories shows you entries from the same date in earlier years. You can hide any entry from Memories, or turn the feature off entirely in Settings.'],
      ['Shared Albums', 'People you invite to a Shared Album can view and comment on its photographs. Removing someone from an album removes their access immediately.'],
      ['Print Shop', 'Orders placed through the Print Shop are fulfilled by an independent print partner. Your order details are shared with the partner only to fulfill and ship your order.'],
      ['Voice Notes', 'Voice notes are stored with the entry they belong to. Transcription happens on your device where your device supports it.'],
      ['Family Plan', 'The organizer of a Family Plan pays for the plan. Members keep their own private entries, which the organizer cannot see.'],
      ['Gift Cards', 'Gift cards can be redeemed for Subscription time and have no cash value except where required by law.'],
      ['Mood Tracking', 'Mood check-ins are optional and are stored like any other entry. You can delete them at any time.'],
      ['Widgets', 'Home-screen widgets show a preview of recent entries. You can choose to blur previews when your device is locked.'],
      ['Web Access', 'You can use Mossbook in a web browser by signing in at the Mossbook website. Sessions expire after thirty (30) days of inactivity.'],
      ['Import', 'You can import entries from other journal apps that export in a standard format. Imported entries are treated like any other Content.'],
      ['Templates', 'Templates help you write entries. Templates you create are private unless you choose to publish them in the template gallery.'],
      ['Year in Review', 'Year in Review creates a summary of your year on your device. Nothing is shared unless you tap Share.'],
    ];
    ctx.f = (ctx.f || 0);
    if (ctx.f >= feats.length) return null;
    const [name, body] = feats[ctx.f++];
    return `D.${ctx.f} ${name}. ${body}`;
  },
  countries(r, ctx) {
    const cs = ['Australia', 'Austria', 'Belgium', 'Brazil', 'Canada', 'Chile', 'Colombia', 'Czechia', 'Denmark', 'Estonia', 'Finland', 'France', 'Germany', 'Greece', 'Hungary', 'Iceland', 'India', 'Indonesia', 'Ireland', 'Israel', 'Italy', 'Japan', 'Kenya', 'Latvia', 'Lithuania', 'Luxembourg', 'Malaysia', 'Mexico', 'the Netherlands', 'New Zealand', 'Nigeria', 'Norway', 'Peru', 'the Philippines', 'Poland', 'Portugal', 'Romania', 'Singapore', 'Slovakia', 'Slovenia', 'South Africa', 'South Korea', 'Spain', 'Sweden', 'Switzerland', 'Taiwan', 'Thailand', 'Turkey', 'the United Arab Emirates', 'the United Kingdom', 'Uruguay', 'Vietnam'];
    ctx.c = ctx.c || 0;
    if (ctx.c >= cs.length) return null;
    const c = cs[ctx.c++];
    const v = [
      () => `the minimum age to use the Service is ${pick(r, ['fourteen (14)', 'fifteen (15)', 'sixteen (16)'])} years`,
      () => `these Terms are governed by the laws of ${c}, and you may bring proceedings in the courts of ${c}`,
      () => `you may withdraw from a Subscription within ${pick(r, ['fourteen (14)', 'seven (7)', 'ten (10)'])} days of purchase and receive a full refund`,
      () => `you may contact the national consumer protection authority of ${c} if you have a complaint we have not resolved`,
      () => `prices include ${pick(r, ['value added tax', 'goods and services tax', 'consumption tax', 'sales tax'])} at the applicable rate`,
      () => `a translated version of these Terms is available in ${pick(r, ['the local language', 'each official language'])}, and both versions have equal force`,
      () => `nothing in these Terms excludes the statutory guarantees that apply to digital services in ${c}`,
      () => `the Service is provided by ${pick(r, ['Mossbook Labs, Inc.', 'Mossbook International B.V.', 'Mossbook Asia Pte. Ltd.'])}`,
      () => `you may request deletion of your Personal Information under the data protection law of ${c}, and we will respond within the period that law requires`,
    ];
    const a = pick(r, v)(), b = pick(r, v)();
    return `E.${ctx.c} ${cap(c)}. If you live in ${c}, ${a}${a === b ? '' : `, and ${b}`}.`;
  },
  processors(r, ctx) {
    const p1 = ['Cobalt', 'Juniper', 'Larch', 'Quill', 'Saltmarsh', 'Tern', 'Vireo', 'Wren', 'Alder', 'Basalt', 'Cinder', 'Dunlin', 'Fennel', 'Gannet', 'Heron', 'Ibis', 'Kestrel', 'Linnet', 'Marten', 'Nettle'];
    const p2 = ['Cloud', 'Systems', 'Data', 'Networks', 'Labs', 'Mail', 'Analytics', 'Hosting', 'Support', 'Payments'];
    const purpose = ['cloud hosting and storage of encrypted Content', 'email delivery for service messages', 'customer support ticketing', 'payment processing for web purchases', 'crash reporting with personal details removed', 'content delivery network', 'fraud prevention for payments', 'database backups', 'push notification delivery', 'image resizing for thumbnails', 'print order fulfillment', 'security monitoring'];
    const loc = ['United States', 'Ireland', 'Germany', 'Canada', 'Singapore', 'the Netherlands', 'Japan', 'Australia'];
    ctx.pr = (ctx.pr || 0) + 1;
    if (ctx.pr > 26) return null;
    return `F.${ctx.pr} ${pick(r, p1)} ${pick(r, p2)}, ${pick(r, ['Inc.', 'Ltd.', 'GmbH', 'B.V.', 'LLC', 'Pte. Ltd.'])}. Purpose: ${pick(r, purpose)}. Location of processing: ${pick(r, loc)}. Safeguards: ${pick(r, ['standard contractual clauses', 'adequacy decision', 'binding corporate rules', 'encryption with keys held by Mossbook'])}.`;
  },
  guidelines(r, ctx) {
    const g = ['Do not post images of other people in a Shared Album without their permission.', 'Do not share content that sexualizes minors. We report it to the relevant authorities.', 'Do not use comments to bully or threaten anyone.', 'Do not share another person\'s private information, such as their address or phone number.', 'Do not post content that promotes violence against any group.', 'Do not impersonate another person.', 'Do not share content you do not have the right to share.', 'Do not use Shared Albums to sell goods or services.', 'Do not post graphic violence without a content warning.', 'Do not encourage self-harm. If you are struggling, the Help page lists support services.', 'Do not post spam or repetitive comments.', 'Do not share malware or links to phishing sites.', 'Respect the decisions of album owners about who can join.', 'Report content you believe breaks these guidelines from the menu on any entry.', 'Repeated violations may lead to the loss of sharing features.', 'We review reports within forty-eight (48) hours in most cases.', 'You can appeal any decision we make about your content.'];
    ctx.g = ctx.g || 0;
    if (ctx.g >= g.length) return null;
    return `G.${ctx.g + 1} ${g[ctx.g++]}`;
  },
};
const money = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- Prose engine ----------
function makeProse(p, r) {
  const used = new Set();
  const fill = (s, ctx) => s
    .replaceAll('{doc}', p.docWord)
    .replaceAll('{Aposs}', p.Aposs).replaceAll('{Bposs}', p.Bposs)
    .replaceAll('{A}', p.A).replaceAll('{B}', p.B)
    .replace(/\{ref\}/g, () => `${ctx.art}.${1 + Math.floor(r() * 6)}`)
    .replace(/\{art\}/g, () => String(1 + Math.floor(r() * ctx.nArts)));
  const subj = (role) => role === 'A' ? p.A : role === 'B' ? p.B : 'Each Party';
  const other = (role) => role === 'A' ? p.B : p.A;
  const ack = () => pick(r, [p.Back, p.Bagree, `Each Party acknowledges`, `The Parties agree`]);

  const tos = p.id === 'terms';
  function sentence(t, ctx) {
    const d = t.duties.length ? pick(r, t.duties) : null;
    const n = t.donts.length ? pick(r, t.donts) : null;
    const f = t.facts.length ? pick(r, t.facts) : null;
    const thing = pick(r, t.things);
    const opts = [];
    const party = (x) => x === 'Each Party' || x === 'Either Party';
    if (d) {
      const S = subj(d[0]);
      if (!/within|at least|twice|monthly|in advance|before|after|upon/.test(d[1])) opts.push([d[1], () => `${S} shall ${d[1]} ${pick(r, generic.within)}.`]);
      opts.push([d[1], () => `${S} shall ${d[1]} ${pick(r, generic.qualifier)}.`]);
      if (!tos) opts.push([d[1], () => `If ${party(S) ? 'a Party' : S} fails to ${d[1]}, the other Party may give written notice of the failure, and the failure shall be remedied ${pick(r, generic.within)}.`]);
      opts.push([d[1], () => `${pick(r, generic.intro)}, ${S === 'Each Party' ? 'each Party' : S === 'Either Party' ? 'either Party' : S} shall ${d[1]}.`]);
    }
    if (n) {
      const S = subj(n[0]);
      opts.push([n[1], () => `Unless ${pick(r, generic.condition)}, ${party(S) ? 'neither Party' : S} shall ${party(S) ? '' : 'not '}${n[1]}.`]);
      opts.push([n[1], () => `${party(S) ? 'Neither Party' : S} may ${party(S) ? '' : 'not '}${n[1]} except ${pick(r, generic.exception)}.`]);
    }
    if (f) {
      opts.push([f, () => `${cap(f)}.`], [f, () => `${cap(f)}.`]);
      opts.push([f, () => `${pick(r, generic.intro)}, ${f}.`]);
      opts.push([f, () => `For the avoidance of doubt, ${f}.`]);
      opts.push([f, () => `${ack()} that ${f}.`]);
      if (!tos) opts.push([f, () => `Notwithstanding Section ${ctx.art}.${1 + Math.floor(r() * 5)}, ${f}.`]);
    }
    opts.push(['construe', () => `Nothing in this Section shall be construed to ${pick(r, generic.construe)}.`]);
    if (!tos) {
      opts.push(['each', () => `Each ${thing} ${pick(r, generic.passive)} under this Section ${pick(r, generic.must)}.`]);
      opts.push(['where', () => `Where ${pick(r, generic.condition)}, the Parties shall ${pick(r, generic.joint)} ${pick(r, generic.within)}.`]);
      opts.push(['survive', () => `The provisions of this Section ${pick(r, generic.survive)}.`]);
      opts.push(['records', () => `${p.A} shall keep accurate records of each ${thing} for ${pick(r, generic.years)}.`]);
      opts.push(['question', () => `Any question concerning a ${thing} shall first be raised between the Parties' designated contacts, who shall ${pick(r, generic.joint)} ${pick(r, generic.within)}.`]);
    } else {
      opts.push(['help', () => `If you have a question about ${pick(r, ['a', 'any'])} ${thing}, you can contact support from the Help page in the App.`]);
      opts.push(['survive', () => `This Section continues to apply after your account is closed, to the extent it concerns events before closure.`]);
    }
    const [core, gen] = pick(r, opts);
    let out = fill(gen(), ctx).replace(/\b([Aa]) ([aeiouAEIOU])/g, '$1n $2').replace(/\s+/g, ' ').replace(/\s\./g, '.');
    if (tos) out = out.replaceAll('this Terms', 'these Terms').replaceAll('the Parties', 'you and Mossbook').replaceAll('Each Party', 'Each of you and Mossbook').replaceAll('Either Party', 'Either you or Mossbook').replaceAll('Neither Party', 'Neither you nor Mossbook').replaceAll('neither Party', 'neither you nor Mossbook').replaceAll('each Party', 'each of you and Mossbook').replaceAll('the other Party', 'the other').replaceAll('a Party', 'you or Mossbook');
    return { s: cap(out), core };
  }

  return function paragraph(topicKeys, ctx, len) {
    const out = [], cores = new Set();
    for (let i = 0, tries = 0; i < len && tries < 80; tries++) {
      const t = topics[pick(r, topicKeys)] || topics.general;
      const { s, core } = sentence(t, ctx);
      if (used.has(s) || cores.has(core)) continue;
      used.add(s); cores.add(core); out.push(s); i++;
    }
    return out.join(' ');
  };
}

// ---------- Build ----------
function buildBlocks(p, variant, exhibitScale) {
  const r = rng(p.seed);
  const o = outlines[p.id];
  const prose = makeProse(p, r);
  const nArts = o.body.length;
  const blocks = []; // {text, kind:'h'|'p', trap?}
  const push = (text, kind = 'p', extra = {}) => blocks.push({ text, kind, ...extra });

  push(p.title.toUpperCase(), 'h');
  if (p.id === 'terms') {
    push('Mossbook Labs, Inc. Last updated: 3 March 2026. These Terms of Service are a fictional document created for a demonstration. Mossbook is not a real company.');
  } else {
    push(`This ${p.title} (this "${p.docWord}") is entered into as of the Effective Date by and between ${p.drafter} ("${p.A}") and the party identified as ${p.B} on the signature page ("${p.B}"). ${p.A} and ${p.B} are each a "Party" and together the "Parties". This is a fictional document created for a demonstration; all names, places and figures are invented.`);
    push(p.id === 'supply'
      ? 'WHEREAS, Supplier is engaged in the precision machining and finishing of metal and polymer components; WHEREAS, Purchaser designs and assembles industrial equipment and wishes to purchase certain components from Supplier; NOW, THEREFORE, in consideration of the mutual covenants set out below, the Parties agree as follows.'
      : 'WHEREAS, Landlord owns the retail center known as Calder Street Market Hall; WHEREAS, Tenant wishes to lease space in it for the operation of a café; NOW, THEREFORE, in consideration of the rent to be paid and the covenants set out below, the Parties agree as follows.');
  }

  const placeIn = (key, paras) => {
    const items = [...p.traps.filter(t => t.article === key).map(t => ({ text: variant === 'full' ? t.nasty : t.fair, at: t.at, trap: t.id })), ...p.fixed.filter(f => f.article === key).map((f, i) => ({ text: f.text, at: 0.15 + 0.2 * i, fixed: true }))];
    for (const it of items.sort((a, b) => b.at - a.at)) {
      const idx = Math.max(1, Math.min(paras.length, Math.round(it.at * paras.length)));
      paras.splice(idx, 0, { text: it.text, kind: 'p', trap: it.trap });
    }
    return paras;
  };

  o.body.forEach(([key, title, nSections], ai) => {
    const art = ai + 1;
    push(`ARTICLE ${art}. ${title.toUpperCase()}`, 'h');
    const ctx = { art, nArts };
    let paras = [];
    if (key === 'definitions') {
      push(`${art}.1 Definitions. In this ${p.docWord}, the following terms have the meanings given below.`);
      for (const [term, def] of definitions[p.id]) paras.push({ text: `"${term}" means ${def}.`, kind: 'p' });
      paras.push({ text: `${art}.2 Interpretation. ${prose(['general'], ctx, 4)}`, kind: 'p' });
    } else {
      const t = topics[key] ? [key] : ['general'];
      for (let s = 1; s <= Math.round(nSections * (p.bodyScale || 1)); s++) {
        const nPar = 1 + Math.floor(r() * 3);
        for (let k = 0; k < nPar; k++) {
          const len = 3 + Math.floor(r() * 4);
          const mix = r() < 0.2 ? [...t, 'general'] : t;
          paras.push({ text: `${k === 0 ? `${art}.${s} ` : `(${'abcdefgh'[k - 1]}) `}${prose(mix, ctx, len)}`, kind: 'p' });
        }
      }
    }
    for (const b of placeIn(key, paras)) blocks.push(b);
  });

  // Signature block
  push(`IN WITNESS WHEREOF, the Parties have caused this ${p.docWord} to be executed by their duly authorized representatives as of the Effective Date.`);

  // Exhibits
  const budgetWords = p.targetPages * p.wordsPerPage * exhibitScale;
  const totalWeight = o.exhibits.reduce((a, e) => a + e[3], 0);
  const bodyWords = blocks.filter(b => !b.trap).reduce((a, b) => a + b.text.split(/\s+/).length, 0);
  const exWords = Math.max(0, budgetWords - bodyWords);
  for (const [key, title, kind, weight] of o.exhibits) {
    push(title.toUpperCase(), 'h');
    const target = exWords * weight / totalWeight;
    let paras = [], wc = 0;
    const ctx = { art: title.split('.')[0].replace('Exhibit ', ''), nArts };
    const r2 = rng(p.seed * 31 + key.length * 7 + title.length);
    if (kind.startsWith('prose:')) {
      const ts = kind.slice(6).split(',');
      let s = 1;
      while (wc < target) {
        const txt = `${title.split('.')[0].replace('Exhibit ', '')}.${s++} ${prose(ts, ctx, 4 + Math.floor(r() * 4))}`;
        paras.push({ text: txt, kind: 'p' }); wc += txt.split(/\s+/).length;
      }
    } else {
      const gctx = {};
      if (key === 'exhibit:legal') paras.push({ text: 'That part of the Southeast Quarter of Section 22, Township 4 North, Range 9 East, in the City of Calder Falls, more particularly described as follows: Commencing at the southeast corner of said Section 22; thence West along the south line of said Section a distance of 1,204.66 feet to the Point of Beginning;', kind: 'p' });
      while (wc < target) {
        const txt = listGen[kind](r2, gctx);
        if (!txt) {
          // List exhausted; continue with related prose so the exhibit reaches its share.
          const ts = { rentschedule: ['rent', 'leaseterm'], metes: ['premises'], opexx: ['opex'], tosfeatures: ['features', 'service'], countries: ['disputes', 'privacy'], processors: ['privacy'], guidelines: ['acceptableuse', 'content'] }[kind] || ['general'];
          const t2 = `${prose(ts, ctx, 5)}`;
          paras.push({ text: t2, kind: 'p' }); wc += t2.split(/\s+/).length; continue;
        }
        paras.push({ text: txt, kind: 'p' }); wc += txt.split(/\s+/).length;
      }
      if (key === 'exhibit:legal') paras.push({ text: 'thence to the Point of Beginning, containing 2.418 acres, more or less, subject to easements and restrictions of record.', kind: 'p' });
    }
    for (const b of placeIn(key, paras)) blocks.push(b);
  }
  push(`End of ${p.title}. Fictional document for demonstration only. Not legal advice.`);
  return blocks;
}

function paginate(blocks, wpp) {
  const pages = [[]]; let wc = 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const w = b.text.split(/\s+/).length;
    // Keep headings with the next paragraph.
    if (wc > 0 && (wc + w > wpp * 1.15 || (b.kind === 'h' && wc > wpp * 0.75))) { pages.push([]); wc = 0; }
    pages[pages.length - 1].push(i); wc += w;
  }
  return pages;
}

export function build(p) {
  let scale = 1, full, pages, used = 1, best = Infinity;
  for (let iter = 0; iter < 16; iter++) {
    const f = buildBlocks(p, 'full', scale);
    const pg = paginate(f, p.wordsPerPage);
    const miss = Math.abs(pg.length - p.targetPages);
    if (miss < best) { best = miss; full = f; pages = pg; used = scale; }
    if (miss === 0) break;
    scale *= 1 + (p.targetPages / pg.length - 1) * (iter < 6 ? 1 : 0.3);
  }
  const clean = buildBlocks(p, 'clean', used);
  if (clean.length !== full.length) throw new Error('clean/full block count mismatch');
  const render = (blocks) => pages.map((idxs, pi) => `[[P${String(pi + 1).padStart(3, '0')}]]\n` + idxs.map(i => blocks[i].text).join('\n\n')).join('\n\n');
  const trapPages = {};
  pages.forEach((idxs, pi) => idxs.forEach(i => { if (full[i].trap) trapPages[full[i].trap] = pi + 1; }));
  return { fullText: render(full), cleanText: render(clean), pageCount: pages.length, trapPages };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await mkdir(OUT, { recursive: true });
  const index = {};
  for (const id of presetOrder) {
    const p = presets[id];
    const { fullText, cleanText, pageCount, trapPages } = build(p);
    await writeFile(path.join(OUT, `${id}.txt`), fullText);
    await writeFile(path.join(OUT, `${id}.clean.txt`), cleanText);
    const wordsN = fullText.split(/\s+/).length;
    index[id] = { pages: pageCount, words: wordsN, trapPages };
    console.log(`${id}: ${pageCount} pages, ${wordsN} words (~${Math.round(wordsN * 1.35 / 1000)}K tokens est.), traps on pages`, trapPages);
  }
  await writeFile(path.join(OUT, 'index.json'), JSON.stringify(index, null, 2));
}
