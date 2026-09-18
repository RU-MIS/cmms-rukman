# QA In-Process Inspection Forms (Google Sheets + Apps Script)

Two mobile-friendly web forms that replace the paper "In-Process Inspection
Report" formats (F/QA/3A - Blow Moulding, F/QA/3B - Injection Moulding).
They are **completely separate** from the rest of this repository (the
BusinessFlow ERP) - no server, no hosting, no database to set up. Each form
is a small Google Apps Script project bound to its own Google Sheet, opened
as a plain link in a phone's browser.

## Why a dropdown instead of the paper's 12 time-slot columns

On paper, each check point has 12 columns (6 slots x Day/A-Shift and Night/
B-Shift) that are too narrow to use on a phone. Instead, the web form:

- Reads the sheet to figure out which slot for that Date + M/C No + Part
  Name hasn't been filled yet, and shows **only that one slot**
  (e.g. "Day/A-Shift - 9 to 11"), in order: 9 to 11, 11 to 1, 1 to 3, 3 to 5,
  5 to 7, 7 to 9 for Day/A-Shift, then the same six for Night/B-Shift.
- The operator can't jump ahead or fill a slot twice - the next slot is
  computed from what's already in the sheet.
- Each submission is saved as **one row** in the Google Sheet (Date,
  Machine, Part, Shift, Time Slot, one column per check point, Remarks, QA
  Inspector Sign, Status), instead of trying to write into a fixed
  spreadsheet grid.

Two buttons at the bottom of the form:
- **Submit** - saves the row with `Status = Submitted`.
- **Submit & Generate Report** - saves the row with `Status = Report
  Generated`.

## One-time setup (repeat for each form)

1. Go to [sheets.google.com](https://sheets.google.com) and create a new,
   blank Google Sheet. Name it e.g. "Blow Moulding Inspection" (or
   "Injection Moulding Inspection" for the other form). You don't need to
   add any headers or columns yourself - the script creates them.
2. In the Sheet, open **Extensions > Apps Script**.
3. Delete anything in the default `Code.gs` file, and paste in the contents
   of this repo's `qa-inspection-forms/blow-moulding/Code.gs` (or
   `injection-moulding/Code.gs`).
4. In the Apps Script editor, click the **+** next to "Files" > **HTML**,
   name the new file exactly `index` (Apps Script adds the `.html`
   extension itself), and paste in the contents of this repo's
   `qa-inspection-forms/blow-moulding/index.html` (or
   `injection-moulding/index.html`).
5. Click **Save** (the disk icon), then **Deploy > New deployment**.
6. Click the gear icon next to "Select type" and choose **Web app**.
7. Fill in:
   - Description: anything, e.g. "Blow Moulding QA Form v1"
   - Execute as: **Me**
   - Who has access: **Anyone with the link** (or **Anyone within
     [your organization]** if everyone filling the form has a work Google
     account - this keeps it off the public internet)
8. Click **Deploy**. The first time, Google will ask you to authorize the
   script - click **Authorize access**, choose your account, click
   **Advanced > Go to (project name)**, then **Allow**.
9. Copy the **Web app URL** it gives you. That's the link operators open on
   their phones (bookmark it, or share via WhatsApp / add it to the home
   screen for an app-like icon).

Repeat the same steps for the other form, in its own Google Sheet.

## Updating the form later

If you edit `Code.gs` or `index.html` in this repo, copy the changes into
the Apps Script editor the same way, save, then **Deploy > Manage
deployments > edit (pencil) > New version > Deploy**. The Web app URL stays
the same.

## Where the data ends up

Each form creates one tab in its Sheet the first time it runs:
"Blow Moulding Log" or "Injection Moulding Log". Every submission is a new
row with all check-point values plus a `Status` column
(`Submitted` / `Report Generated`) - nothing is ever overwritten, so the
sheet is a full audit trail you can filter, pivot, or export from Google
Sheets directly.

## Files

```
qa-inspection-forms/
  blow-moulding/
    Code.gs       # server-side logic + check point list for F/QA/3A
    index.html    # the mobile form UI
  injection-moulding/
    Code.gs       # server-side logic + check point list for F/QA/3B
    index.html    # the mobile form UI (identical to blow-moulding's)
```
