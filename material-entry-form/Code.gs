function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
      .setTitle('Material Entry Web Form')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// 1. Dropdown data lane ka function
//    - Plants: "master" sheet, column C, row 2 se neeche
//    - Items:  "Item Master" sheet, column B, row 3 se neeche
function getMasterData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var plants = [];
  var masterSheet = ss.getSheetByName("master");
  if (masterSheet) {
    var lastRow = masterSheet.getLastRow();
    if (lastRow >= 2) {
      var plantData = masterSheet.getRange(2, 3, lastRow - 1, 1).getValues();
      for (var i = 0; i < plantData.length; i++) {
        if (plantData[i][0] && plants.indexOf(plantData[i][0]) === -1) {
          plants.push(plantData[i][0]);
        }
      }
    }
  }

  var items = [];
  var itemMasterSheet = ss.getSheetByName("Item Master");
  if (itemMasterSheet) {
    var lastRow2 = itemMasterSheet.getLastRow();
    if (lastRow2 >= 3) {
      var itemData = itemMasterSheet.getRange(3, 2, lastRow2 - 2, 1).getValues();
      for (var j = 0; j < itemData.length; j++) {
        if (itemData[j][0] && items.indexOf(itemData[j][0]) === -1) {
          items.push(itemData[j][0]);
        }
      }
    }
  }

  return { plants: plants, items: items };
}

// Helper function: Date ko dd-mmm-yyyy format me badalne ke liye
function formatDateToDdMmmYyyy(date) {
  var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var day = ("0" + date.getDate()).slice(-2);
  var monthStr = months[date.getMonth()];
  var year = date.getFullYear();

  return day + "-" + monthStr + "-" + year; // Format: 10-Jul-2026
}

// 2. Form submit hone par data "FG In Data" sheet me last 50 rows check karke DIRECT save karne ka function
// Column layout: A=Date, B=From Plant No., C=(blank), D=PART DESCRIPTION, E=QTY, F=Unit, G=To Warehouse
function saveFormData(entry) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var targetSheet = ss.getSheetByName("FG In Data");

  if (!targetSheet) {
    targetSheet = ss.insertSheet("FG In Data");
    targetSheet.appendRow(["Date", "From Plant No.", "", "PART DESCRIPTION", "QTY", "Unit", "To Warehouse"]);
  }

  var today = new Date();
  var formattedDate = formatDateToDdMmmYyyy(today);

  var lastRow = targetSheet.getLastRow();
  var existingData = [];
  var startRow = 1;

  // Agar sheet me 50 se zyada rows hain, toh sirf pichli 50 rows hi read karenge speed ke liye
  if (lastRow > 50) {
    startRow = lastRow - 49;
    existingData = targetSheet.getRange(startRow, 1, 50, 7).getValues(); // A:G poora
  } else if (lastRow > 1) {
    existingData = targetSheet.getRange(2, 1, lastRow - 1, 7).getValues();
  }

  var savedCount = 0;
  var duplicateCount = 0;
  var fromPlant = entry.fromPlant;
  var toWarehouse = entry.toWarehouse;

  entry.items.forEach(function(item) {
    if (item.partName) {
      var isDuplicate = false;

      // Duplication Check (Sirf filtered 50 rows ke upar loop chalega)
      for (var i = 0; i < existingData.length; i++) {
        if (!existingData[i][0]) continue;

        var rowDate = "";
        if (existingData[i][0] instanceof Date) {
          rowDate = formatDateToDdMmmYyyy(existingData[i][0]);
        } else {
          rowDate = existingData[i][0].toString().trim();
        }

        var rowFromPlant = existingData[i][1].toString().trim();     // Column B
        var rowPartName = existingData[i][3].toString().trim();      // Column D
        var rowToWarehouse = existingData[i][6].toString().trim();   // Column G

        // Match conditions
        if (rowDate === formattedDate &&
            rowFromPlant === fromPlant.trim() &&
            rowToWarehouse === toWarehouse.trim() &&
            rowPartName === item.partName.trim()) {
          isDuplicate = true;
          break;
        }
      }

      if (!isDuplicate) {
        targetSheet.appendRow([formattedDate, fromPlant, "", item.partName, item.qty, item.unit, toWarehouse]);
        savedCount++;
      } else {
        duplicateCount++;
      }
    }
  });

  if (savedCount > 0 && duplicateCount > 0) {
    return savedCount + " entries save ho gayi hain. " + duplicateCount + " duplicate entries skip kar di gayin.";
  } else if (savedCount > 0 && duplicateCount === 0) {
    return "Sabhi data safaltapurwak 'FG In Data' sheet me save ho gaya hai!";
  } else if (savedCount === 0 && duplicateCount > 0) {
    return "Data save nahi hua! Yeh entry aaj ki date me pehle se hi sheet me maujood hai.";
  } else {
    return "Koi valid data nahi mila.";
  }
}
