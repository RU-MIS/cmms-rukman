You are a Senior ERP Developer and Inventory Management System Architect.

I want you to build ONLY the following MVP module inside the existing
"Rukman Dataflow Management System" project.

Do not start HRMS.
Do not start Attendance.
Do not start full Accounting.
Do not start unnecessary ERP modules.

The current scope is:

INVENTORY MANAGEMENT
+
MULTIPLE GODOWNS
+
RACK / SHELF / BIN LOCATION
+
CUSTOMER PORTAL
+
VENDOR PORTAL
+
CUSTOMER PO
+
VENDOR PO
+
STOCK RESERVATION
+
PURCHASE RECEIVING
+
SALES ORDER / DISPATCH
+
DOCUMENT UPLOAD
+
EMAIL AUTOMATION
+
PAYMENT TRACKING
+
PAYMENT REMINDER AUTOMATION
+
OWNER/ADMIN SETTINGS

========================================================
1. FIRST INSPECT THE EXISTING PROJECT
========================================================

Before changing anything:

1. Inspect the existing repository.
2. Understand the existing architecture.
3. Identify whether the current project uses Supabase/Firebase/other DB.
4. Identify existing inventory-related code.
5. Identify existing customer/vendor/PO code.
6. Identify reusable components.
7. Do NOT delete working functionality.
8. Do NOT rebuild existing functionality unnecessarily.

Reuse existing code where practical.

If the current project already has a database architecture, adapt the
new module to the existing architecture unless there is a strong
technical reason to change it.

Do not destroy existing business logic.

========================================================
2. INVENTORY IS THE CORE OF THIS MVP
========================================================

Build a professional inventory system.

Inventory must support:

- Multiple Godowns
- Multiple locations
- Rack
- Shelf / Level
- Bin / Position
- Item-wise stock
- Godown-wise stock
- Location-wise stock
- Consolidated stock
- Physical stock
- Reserved stock
- Available stock
- Stock IN
- Stock OUT
- Stock Transfer
- Stock Adjustment
- Stock Movement History

========================================================
3. MULTIPLE GODOWNS
========================================================

A company can have multiple godowns.

Example:

Delhi Godown
Noida Godown
Factory Godown

The same item can exist in all three.

Example:

10mm Bolt

Delhi = 8,000
Noida = 7,000
Factory = 5,000

Total = 20,000

I want ONE consolidated inventory screen where the owner/admin can
see the total stock of an item across all godowns.

Example:

10mm Bolt
Total Stock: 20,000

When the user opens the item, show:

Delhi Godown       8,000
Noida Godown       7,000
Factory Godown     5,000

The system must maintain the actual godown-wise quantities internally.

========================================================
4. RACK / SHELF / BIN SYSTEM
========================================================

Inventory must support physical storage locations.

Structure:

Godown
 → Zone
   → Rack
     → Shelf / Level
       → Bin / Position

Example:

Delhi Godown
Zone A
Rack B1
Level C
Bin 123

Display location as:

B1-C-123

Example:

10mm Bolt
Quantity: 5,000
Location: B1-C-123

An item may exist in multiple locations.

Example:

10mm Bolt

Delhi / B1-C-123 = 5,000
Delhi / B1-C-124 = 3,000
Noida / A2-B-041 = 7,000
Factory / F1-A-009 = 5,000

Total = 20,000

========================================================
5. STOCK TYPES
========================================================

Maintain:

Physical Stock
Reserved Stock
Available Stock

Formula:

Available Stock =
Physical Stock - Reserved Stock

Example:

Physical = 20,000
Reserved = 2,000
Available = 18,000

Do NOT allow available stock to become negative unless the company
explicitly enables negative stock.

Create an Owner/Admin setting:

Allow Negative Stock
ON / OFF

Default:

OFF

========================================================
6. STOCK MOVEMENT
========================================================

Do NOT simply allow users to type/change stock balances.

Maintain stock through movements.

Movement types:

STOCK_IN
STOCK_OUT
STOCK_TRANSFER_OUT
STOCK_TRANSFER_IN
STOCK_ADJUSTMENT
RESERVATION
RESERVATION_RELEASE
PURCHASE_RECEIPT
SALE_DISPATCH

Every stock movement should record:

item
godown
location
quantity
unit
movement type
reference document
reference ID
date
user
timestamp

Historical stock movements should not be directly editable.

Corrections should happen through stock adjustment/reversal.

========================================================
7. ITEM MASTER
========================================================

Create Item Master with:

Item Code
Item Name
Description
Category
Brand
Base Unit
Purchase Unit
Sales Unit
Packing
Barcode
Purchase Price
Sale Price
Minimum Stock
Maximum Stock
Reorder Level
Active/Inactive

========================================================
8. ITEM-SPECIFIC PACKING
========================================================

Packing conversion must be item-specific.

Example:

Item A:
1 Box = 24 Pairs

Item B:
1 Box = 36 Pairs

Item C:
1 Box = 18 Pairs

Do NOT create one global conversion.

Store:

Base Unit
Secondary Unit
Conversion Factor

Example:

20 Boxes
= 480 Pairs

Inventory should use the reliable base quantity internally.

UI can display both:

20 Boxes / 480 Pairs

========================================================
9. CUSTOMER PORTAL
========================================================

Customers should have their own login.

Customer can:

- Login
- View allowed products
- View stock if enabled
- View rate if enabled
- Create their own PO
- Enter quantity
- Enter their requested/quoted price if allowed
- Submit PO
- View PO status
- View order status
- View invoices
- View payment history
- View outstanding if allowed

Customer must ONLY see their own information.

Customer must never see:

- Other customers
- Vendors
- Internal purchase cost
- Internal margin
- Internal accounting
- Internal stock movement
- Other company's data

========================================================
10. CUSTOMER PO
========================================================

Customer can create a PO.

PO fields:

Customer
PO Number
PO Date
Items
Quantity
Requested Price
Requested Delivery Date
Remarks
Attachments

Customer can enter their own quote price.

Example:

Company reference price:
₹150

Customer enters:
₹140

Store:

customerQuotedPrice = ₹140

Do NOT automatically make ₹140 the final sale price.

Internal company user must review it.

Workflow:

Customer PO
    ↓
Internal Review
    ↓
Approve
OR
Modify Price
OR
Reject
    ↓
Final Approved Price
    ↓
Sales Order
    ↓
Stock Reservation
    ↓
Dispatch

Store both the original customer quote and final approved price.

========================================================
11. CUSTOMER STOCK VISIBILITY
========================================================

THIS IS VERY IMPORTANT.

Owner/Admin must be able to control whether customers can see stock.

Setting:

Customer Stock Visibility

Options:

HIDDEN
EXACT_QUANTITY
AVAILABLE_STATUS
AVAILABLE_TO_PROMISE

If:

HIDDEN

Customer sees no quantity.

If:

EXACT_QUANTITY

Customer sees:

10mm Bolt
Available: 18,000

If:

AVAILABLE_STATUS

Customer sees:

IN STOCK
LOW STOCK
OUT OF STOCK

If:

AVAILABLE_TO_PROMISE

Customer sees only stock available for commitment.

========================================================
12. VENDOR STOCK VISIBILITY
========================================================

Create a separate setting:

Vendor Stock Visibility

Options:

HIDDEN
EXACT_QUANTITY
AVAILABLE_STATUS
AVAILABLE_TO_PROMISE

Customer and Vendor settings must be completely independent.

========================================================
13. CUSTOMER RATE VISIBILITY
========================================================

Owner/Admin must control whether customers can see prices.

Setting:

Customer Rate Visibility

Options:

VISIBLE
HIDDEN

If hidden:

Customer can still create a PO if permitted,
but should not see internal/base pricing.

========================================================
14. VENDOR RATE VISIBILITY
========================================================

Create:

Vendor Rate Visibility

VISIBLE
HIDDEN

Vendor must never see internal information unless explicitly allowed.

========================================================
15. INDIVIDUAL CUSTOMER/VENDOR OVERRIDES
========================================================

Global settings are not enough.

Support individual overrides.

Example:

Global Customer Stock Visibility:
HIDDEN

Customer A:
EXACT_QUANTITY

Customer B:
HIDDEN

Same concept for:

Stock visibility
Rate visibility
Email
Payment reminders

Priority must be:

Individual Override
        ↓
Company Setting
        ↓
System Default

========================================================
16. CUSTOMER-SPECIFIC PRICING
========================================================

Support customer-specific pricing.

Example:

Item 101

Base Price:
₹150

Customer A:
₹145

Customer B:
₹138

Customer C:
₹150

Pricing and price visibility are two separate concepts.

A customer may have a configured price but the company can still choose
whether that customer is allowed to see the price.

========================================================
17. VENDOR PORTAL
========================================================

Company creates the Vendor PO.

Vendor does NOT need to create a PO.

Vendor portal should mainly provide:

- Login
- Assigned PO
- PO details
- Supply status
- Ordered quantity
- Received quantity
- Pending quantity
- Payment status
- Payment history
- Documents if allowed

Vendor cannot see other vendors or customers.

========================================================
18. PURCHASE PO
========================================================

Internal Purchase user creates Vendor PO.

PO should contain:

Vendor
PO Number
Date
Items
Quantity
Rate
Expected Delivery
Remarks
Attachments

Support:

FULL RECEIVING
PARTIAL RECEIVING

Also support direct purchase receiving without PO.

========================================================
19. PARTIAL RECEIVING
========================================================

For every PO item maintain:

Ordered Quantity
Received Quantity
Pending Quantity

Formula:

Pending =
Ordered - Received

Example:

Ordered = 500
Received = 140
Pending = 360

Next receipt:

100

Pending = 260

Final:

260

Pending = 0

Once pending becomes 0:

REMOVE THAT ITEM FROM THE PENDING RECEIVING SCREEN.

If a PO has 10 items and only 3 are pending:

Show ONLY those 3 pending items.

Fully received items must disappear.

Never allow:

Received > Ordered

Reject over-receiving.

PO status:

OPEN
PARTIALLY_RECEIVED
FULLY_RECEIVED
CANCELLED
CLOSED

========================================================
20. PURCHASE RECEIVING
========================================================

When receiving stock:

1. Validate PO if PO-linked.
2. Validate pending quantity.
3. Validate item.
4. Select Godown.
5. Select Rack/Shelf/Bin.
6. Enter received quantity.
7. Create stock IN.
8. Update received quantity.
9. Calculate pending quantity.
10. Update PO status.
11. Create audit record.

Stock must actually increase in the selected location.

========================================================
21. SALES / CUSTOMER ORDER
========================================================

After customer PO is approved:

Create Sales Order.

Sales flow:

Customer PO
    ↓
Internal Review
    ↓
Approval
    ↓
Sales Order
    ↓
Stock Reservation
    ↓
Dispatch
    ↓
Stock OUT
    ↓
Invoice/document

Before reservation/dispatch:

validate available stock.

========================================================
22. STOCK RESERVATION
========================================================

When an approved customer order requires stock:

Reserve stock.

Example:

Physical:
20,000

Reserved:
5,000

Available:
15,000

Reservation must not physically reduce stock.

When dispatch occurs:

Physical stock decreases.

Reservation is released/reduced.

========================================================
23. STOCK TRANSFER
========================================================

Support:

Godown → Godown

Example:

Delhi:
5,000

Transfer:
2,000

Delhi:
3,000

Noida:
+2,000

Create:

STOCK_TRANSFER_OUT
STOCK_TRANSFER_IN

Do not simply overwrite balances.

========================================================
24. DOCUMENT UPLOAD
========================================================

Accounts/Purchase users must be able to upload documents.

Examples:

PO PDF
Invoice PDF
Purchase document
Delivery document
Payment document
Other attachment

Documents should be attached to the relevant:

PO
Invoice
Payment
Customer
Vendor

Store document metadata.

========================================================
25. AUTOMATIC VENDOR EMAIL
========================================================

When Accounts/Purchase uploads a vendor document:

System should:

1. Save document.
2. Save document metadata.
3. Find related Vendor PO.
4. Generate/use PO PDF.
5. Check email setting.
6. If enabled, send email to vendor.
7. Include PO PDF + uploaded document.
8. Save email history.
9. Retry failed email.

IMPORTANT:

If email fails, the ERP transaction must NOT fail.

Document upload must remain successful.

========================================================
26. CUSTOMER INVOICE EMAIL
========================================================

When Customer Sales Invoice PDF is ready/uploaded:

Check:

Customer Invoice Email = ON/OFF

If ON:

Automatically email invoice to customer.

If OFF:

Do not email.

Record:

Recipient
Invoice
Document
Date
Status
Error

========================================================
27. EMAIL MASTER SETTINGS
========================================================

Create Settings → Email.

Owner/Admin can control independently:

Email Automation
ON/OFF

Vendor PO Email
ON/OFF

Vendor Document Email
ON/OFF

Customer Invoice Email
ON/OFF

Customer Document Email
ON/OFF

Payment Reminder Email
ON/OFF

Vendor Payment Reminder
ON/OFF

No code change should be required.

========================================================
28. PAYMENT TRACKING
========================================================

Track:

Customer Payments
Vendor Payments

Payment methods:

Cash
Bank
UPI
Cheque
Other

Support:

Bank → Cash
Cash → Bank
Bank → Bank

Payment allocation must support:

One payment → multiple invoices

One invoice → multiple payments

========================================================
29. CUSTOMER PAYMENT REMINDER
========================================================

Owner/Admin can enable/disable payment reminders.

Setting:

Customer Payment Reminder
ON/OFF

Reminder Start:

X days before due date.

Example:

Invoice Due:
30 October

Setting:
15 days before due

Reminder starts:
15 October

Continue daily until fully paid.

========================================================
30. PARTIAL PAYMENT
========================================================

Example:

Invoice:
₹100,000

Paid:
₹40,000

Outstanding:
₹60,000

Reminder continues.

If another:

₹60,000

is paid:

Outstanding:
₹0

Reminder automatically stops.

Never send reminders for fully paid invoices.

========================================================
31. VENDOR PAYMENT REMINDER
========================================================

Vendor payment reminders should normally go to internal company users.

Example:

Vendor:
ABC Supplier

Amount:
₹75,000

Due:
30 October

Notify:

Accounts
Owner
Admin

according to configuration.

========================================================
32. PAYMENT REMINDER SETTINGS
========================================================

Owner/Admin can configure:

Customer Reminder:
ON/OFF

Customer Start Days:
10 / 15 / 20 / 30 / custom

Customer Frequency:
DAILY / WEEKLY

Vendor Reminder:
ON/OFF

Vendor Start Days:
10 / 15 / 20 / 30 / custom

Vendor Frequency:
DAILY / WEEKLY

These values must be stored in company settings.

========================================================
33. OWNER/ADMIN CONTROL CENTER
========================================================

Create a professional Settings page.

Owner/Admin must be able to control:

CUSTOMER PORTAL
ON/OFF

VENDOR PORTAL
ON/OFF

CUSTOMER STOCK VISIBILITY
HIDDEN / EXACT / STATUS / ATP

VENDOR STOCK VISIBILITY
HIDDEN / EXACT / STATUS / ATP

CUSTOMER RATE VISIBILITY
ON/OFF

VENDOR RATE VISIBILITY
ON/OFF

CUSTOMER QUOTE PRICE
ON/OFF

EMAIL AUTOMATION
ON/OFF

CUSTOMER INVOICE EMAIL
ON/OFF

VENDOR DOCUMENT EMAIL
ON/OFF

CUSTOMER PAYMENT REMINDER
ON/OFF

VENDOR PAYMENT REMINDER
ON/OFF

NEGATIVE STOCK
ON/OFF

========================================================
34. IMPORTANT SETTINGS BEHAVIOR
========================================================

These settings must actually affect the application.

Example:

Owner disables:

Customer Stock Visibility

Immediately:

Customer portal must not expose stock quantity.

Owner enables:

Customer Stock Visibility

Customer portal can show the configured stock view.

Owner disables:

Customer Rate Visibility

Customer must not see price.

Owner disables:

Email Automation

No automatic email should be generated/sent.

Owner disables:

Payment Reminder

No payment reminder should be generated.

========================================================
35. SECURITY
========================================================

Customer must only access their own:

PO
orders
invoices
payments
documents

Vendor must only access their own:

PO
supply status
payments
documents

Do NOT rely only on hiding UI.

Enforce security at backend/database/security-rule level.

A customer must not be able to manipulate:

stock
approved price
companyId
other customers
payment status
invoice amount

by modifying browser requests.

========================================================
36. DATABASE ARCHITECTURE
========================================================

Use the project's existing database if it is already mature.

If Firebase is already configured or migration is appropriate,
use:

Firebase Authentication
Firestore
Cloud Functions
Firebase Storage
Firestore Security Rules
Storage Security Rules

Do NOT blindly migrate an existing working Supabase system without
first inspecting it.

Critical inventory operations must happen server-side.

========================================================
37. CRITICAL INVENTORY TRANSACTIONS
========================================================

Stock IN:

Validate
→ create movement
→ update stock
→ update PO receiving
→ update pending quantity
→ update status
→ audit

Stock OUT:

Validate stock
→ validate reservation
→ create movement
→ reduce physical stock
→ release reservation
→ audit

Stock Transfer:

Validate source
→ OUT source
→ IN destination
→ audit

If an operation fails, do not leave half-completed inventory.

========================================================
38. UI REQUIREMENTS
========================================================

Build a professional ERP-style UI.

Main Inventory screen:

----------------------------------------------------
Inventory
----------------------------------------------------

Search Item [________________]

Godown [All ▼]
Category [All ▼]
Stock Status [All ▼]

----------------------------------------------------
Item       Total   Reserved   Available   Locations
----------------------------------------------------

10mm Bolt  20,000   2,000      18,000      4

----------------------------------------------------

Clicking item opens location breakdown.

========================================================
39. INVENTORY DETAIL SCREEN
========================================================

Example:

10mm Bolt

Total Physical:
20,000

Reserved:
2,000

Available:
18,000

Sale Price:
₹123

----------------------------------------------------

GODOWN BREAKDOWN

Delhi Godown
8,000

Noida Godown
7,000

Factory Godown
5,000

----------------------------------------------------

LOCATION BREAKDOWN

Delhi / B1-C-123
5,000

Delhi / B1-C-124
3,000

Noida / A2-B-041
7,000

Factory / F1-A-009
5,000

========================================================
40. CUSTOMER PORTAL UI
========================================================

Customer dashboard should show only permitted information.

Example:

My Orders
My POs
My Invoices
My Payments
Outstanding

Product catalog:

Item
Description
Price (if allowed)
Stock (if allowed)
Request Quantity
Create PO

========================================================
41. VENDOR PORTAL UI
========================================================

Vendor dashboard:

My POs
Pending Supply
Received
Pending
Payment Status
Payment History
Documents

Do not show unrelated company data.

========================================================
42. RESPONSIVE DESIGN
========================================================

Primary target:

Desktop ERP usage.

Also make the interface responsive for:

Tablet
Mobile

Do not sacrifice desktop ERP usability.

========================================================
43. TESTING
========================================================

After implementation test at minimum:

1. Multiple godowns
2. Consolidated stock
3. Rack/bin
4. Same item in multiple locations
5. Stock reservation
6. Stock transfer
7. Customer PO
8. Customer quote price
9. Internal price approval
10. Customer stock hidden
11. Customer stock visible
12. Vendor stock hidden
13. Customer rate hidden
14. Customer rate visible
15. Customer-specific override
16. Vendor-specific override
17. Purchase PO
18. Partial receiving
19. Full receiving
20. Over-receiving rejection
21. Document upload
22. Email enabled
23. Email disabled
24. Customer invoice email
25. Vendor document email
26. Customer payment reminder
27. Partial payment
28. Reminder stop after full payment
29. Vendor payment reminder
30. Unauthorized customer access
31. Unauthorized vendor access
32. Stock manipulation attempt
33. Company isolation

========================================================
44. NO FAKE IMPLEMENTATION
========================================================

Do not create buttons that do nothing.

Do not create fake stock numbers.

Do not hard-code demo stock into production logic.

Do not use fake email success.

Do not make the UI appear functional when backend logic does not exist.

========================================================
45. DEVELOPMENT BEHAVIOR
========================================================

You must work autonomously.

Do:

INSPECT
→ DESIGN
→ IMPLEMENT
→ TEST
→ FIX
→ RE-TEST

If you find an error:

Diagnose it yourself.

Fix it yourself.

Run the relevant test/build again.

Continue.

Do not stop after creating only the UI.

The feature is complete only when:

Frontend
+
Backend
+
Database
+
Security
+
Business Logic
+
Testing

are working together.

========================================================
46. DOCUMENTATION
========================================================

Document the implemented module.

Create/update:

/docs/INVENTORY_MODULE.md

Include:

Architecture
Data model
Inventory logic
Stock calculation
Godown logic
Rack/bin logic
Reservation logic
Customer visibility
Vendor visibility
Pricing visibility
Email settings
Payment reminder settings
Security rules
Testing

========================================================
47. FINAL REQUIREMENT
========================================================

START NOW.

First inspect the existing project.

Then identify what already exists.

Then implement ONLY this Inventory + Customer/Vendor Portal +
PO + Document + Email + Payment Reminder MVP.

Do not build unrelated modules.

Do not delete useful existing code.

Do not repeatedly ask me what to do.

Make reasonable engineering decisions yourself.

Continue until the module is functional, tested and integrated into
Rukman Dataflow Management System.

DO NOT JUST TELL ME HOW TO BUILD IT.

BUILD IT.
