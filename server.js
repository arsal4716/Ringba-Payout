const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");
const axios = require("axios");
const path = require("path");
const fs = require("fs");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));

const AUTH_TOKEN =
  "09f0c9f0ce65fca7fd49064ab10d2bac546768a83565a230c05b281ee1fc09c03c4e30e1ac0cf291867863037c64db4d56eb3789999525c64e619e34ba9f57ffac493ecf47c697ea306751b20db941f29eb6f04f71cad7433e58edd98fb7a520900154a7b7dd126c32447dffd5bace47750c37f4";
const UPLOAD_DIR = "uploads";
const DOWNLOAD_DIR = "downloads";

const upload = multer({ dest: UPLOAD_DIR });

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function formatPhoneNumber(phoneNumber) {
  if (!phoneNumber) return null;

  const phoneStr = phoneNumber.toString();
  const digitsOnly = phoneStr.replace(/\D/g, "");

  console.log("digit phone no", digitsOnly);
  if (/[Xx]/.test(phoneStr)) {
    const match = digitsOnly.match(/^(\d{6})/);
    return match ? `+1${match[1]}` : null;
  }
  if (digitsOnly.length === 10) return `+1${digitsOnly}`;
  if (digitsOnly.length === 11 && digitsOnly.startsWith("1"))
    return `+${digitsOnly}`;
  if (digitsOnly.length === 6) return `+1${digitsOnly}`;

  return null;
}

async function getInboundCallIds(
  phoneNumber,
  targetName,
  reportStart,
  reportEnd,
  checkHasPayout = false
) {
  try {
    console.log(
      `[Fetch] Phone: ${phoneNumber}, Target: ${targetName}, CheckPayout: ${checkHasPayout}`
    );

    const filters = [
      {
        anyConditionToMatch: [
          {
            column: "inboundPhoneNumber",
            value: phoneNumber,
            isNegativeMatch: false,
            comparisonType: "BEGINS_WITH",
          },
        ],
      },
      {
        anyConditionToMatch: [
          {
            column: "targetName",
            value: targetName,
            isNegativeMatch: false,
            comparisonType: "EQUALS",
          },
        ],
      },
    ];
    if (checkHasPayout) {
      filters.push({
        anyConditionToMatch: [
          {
            column: "payoutAmount",
            value: "0",
            isNegativeMatch: false,
            comparisonType: "GREATER_THAN",
          },
        ],
      });
    }

  

    const response = await axios.post(
      "https://api.ringba.com/v2/RAec22abec294c46ddba910daf69d8489c/calllogs",
      {
        reportStart,
        reportEnd,
        filters,
      },
      {
        headers: {
          Authorization: `Token ${AUTH_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    const records = response.data.report.records || [];

    if (records.length === 0) {
      console.log(
        `No records found for ${phoneNumber} (payout filter: ${checkHasPayout})`
      );
      return {
        success: true,
        callIds: [],
        noRecords: true,
      };
    }

    if (records.length === 1) {
      return { success: true, callIds: [records[0].inboundCallId] };
    }
    let longestCall = records[0];
    for (const record of records) {
      if (
        (record.connectedCallLengthInSeconds || 0) >
        (longestCall.connectedCallLengthInSeconds || 0)
      ) {
        longestCall = record;
      }
    }

    return {
      success: true,
      callIds: [longestCall.inboundCallId],
      recordCount: records.length,
    };
  } catch (error) {
    console.error(
      `[Fetch Error] ${phoneNumber}:`,
      error.response?.data || error.message
    );
    return {
      success: false,
      message: error.response?.data?.message || error.message,
    };
  }
}

async function postPaymentDetails(inboundCallId, revenue, payout) {
  try {
    const response = await axios.post(
      "https://api.ringba.com/v2/RAec22abec294c46ddba910daf69d8489c/calls/payments/override",
      {
        INBOUNDCALLID: inboundCallId,
        reason: "Call payments adjusted by acct. Admin.",
        adjustConversion: true,
        adjustPayout: true,
        newConversionAmount: revenue,
        newPayoutAmount: payout,
      },
      {
        headers: { Authorization: `Token ${AUTH_TOKEN}` },
      }
    );

    console.log(`Payment posted: ${inboundCallId}`);
    return { success: true };
  } catch (error) {
    console.error(
      `[Payment Error] ${inboundCallId}: ${
        error.response?.data?.message || error.message
      }`
    );
    return { success: false };
  }
}

app.post("/upload", upload.single("file"), async (req, res) => {
  const { reportStart, reportEnd, processType } = req.body;
  const filePath = req.file?.path;

  if (!filePath) {
    return res
      .status(400)
      .json({ success: false, message: "No file uploaded." });
  }

  try {
    const workbook = XLSX.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet);

    const totalRecords = data.length;
    console.log(`\n Total records in file: ${totalRecords}`);
    console.log(`Process type: ${processType}`);

    const BATCH_SIZE = 10;
    const delayBetweenBatches = 2000;
    const invalidRows = [];
    const noRecordFoundNumbers = [];
    const noPayoutRecords = []; // NEW: Track numbers with no payout
    const processedRecords = [];

    const requiredColumns = [
      "inboundPhoneNumber",
      "targetName",
      "revenue",
      "payout",
    ];

    const batches = [];
    for (let i = 0; i < data.length; i += BATCH_SIZE) {
      batches.push(data.slice(i, i + BATCH_SIZE));
    }

    for (let i = 0; i < batches.length; i++) {
      const startRow = i * BATCH_SIZE + 1;
      const endRow = Math.min((i + 1) * BATCH_SIZE, totalRecords);
      console.log(`\nProcessing batch ${i + 1} (${startRow} → ${endRow})`);

      const promises = batches[i].map(async (row, index) => {
        const rowIndex = i * BATCH_SIZE + index + 1;
        console.log(`Processing record #${rowIndex}...`);

        const keys = Object.keys(row).map((k) => k.toLowerCase());
        if (!requiredColumns.every((col) => keys.includes(col.toLowerCase()))) {
          invalidRows.push({
            rowIndex,
            row,
            error: "Missing required columns.",
          });
          return;
        }

        const phoneNumber = formatPhoneNumber(row.inboundPhoneNumber);
        if (!phoneNumber) {
          invalidRows.push({
            rowIndex,
            row,
            error: "Invalid phone number format.",
          });
          return;
        }

        const { targetName, revenue, payout } = row;
        const checkHasPayout = processType === "withPayout";

        const result = await getInboundCallIds(
          phoneNumber,
          targetName,
          reportStart,
          reportEnd,
          checkHasPayout
        );

        if (result.success && result.callIds.length) {
          for (const callId of result.callIds) {
            await postPaymentDetails(callId, revenue, payout);
          }
          processedRecords.push({
            rowIndex,
            phoneNumber,
            targetName,
            status: "Processed",
          });
        } else {
          if (checkHasPayout && result.noRecords) {
            noPayoutRecords.push(phoneNumber);
            processedRecords.push({
              rowIndex,
              phoneNumber,
              targetName,
              status: "No payout records found",
            });
          } else {
            noRecordFoundNumbers.push(phoneNumber);
            processedRecords.push({
              rowIndex,
              phoneNumber,
              targetName,
              status: "No records found",
            });
          }
        }
      });

      await Promise.all(promises);

      if (i < batches.length - 1) {
        console.log(
          ` Waiting ${delayBetweenBatches / 2}s before next batch...`
        );
        await delay(delayBetweenBatches);
      }
    }

    fs.unlinkSync(filePath);

    console.log("\n All batches processed successfully!");

    return res.json({
      success: true,
      message: "Processing complete.",
      totalRecords,
      processedRecords: processedRecords.length,
      noRecordFoundNumbers,
      noPayoutRecords,
      invalidRows,
      summary: {
        total: totalRecords,
        processed: processedRecords.length,
        failed: invalidRows.length + noRecordFoundNumbers.length + noPayoutRecords.length,
        batches: batches.length,
        noPayoutCount: noPayoutRecords.length, 
      },
    });
  } catch (error) {
    console.error("Processing error:", error);
    return res
      .status(500)
      .json({ success: false, message: "File processing error." });
  }
});

app.use(express.static(path.join(__dirname, 'frontend/build')));
app.get(/^\/(?!api).*$/, (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend/build', 'index.html'));
});

app.use("/uploads", express.static(path.join(__dirname, UPLOAD_DIR)));

const PORT = process.env.PORT || 6002;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
