// server.js - Full updated server with both Ringba and CallGrid support
require("dotenv").config();
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

// ==================== CONFIGURATION ====================
const RINGBA_AUTH_TOKEN = process.env.RINGBA_AUTH_TOKEN;
const CALLGRID_AUTH_TOKEN = process.env.CALLGRID_AUTH_TOKEN;
const RINGBA_API_BASE = process.env.RINGBA_API_BASE;

const CALLGRID_ORG_ID = process.env.CALLGRID_ORG_ID;
const CALLGRID_API_BASE = process.env.CALLGRID_API_BASE;

const REQUIRED_ENV_VARS = [
  "RINGBA_AUTH_TOKEN",
  "RINGBA_API_BASE",
  "CALLGRID_AUTH_TOKEN",
  "CALLGRID_ORG_ID",
  "CALLGRID_API_BASE",
];
const missingEnvVars = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
if (missingEnvVars.length) {
  console.error(
    `[Config Error] Missing required environment variables: ${missingEnvVars.join(", ")}. Check your .env file (see .env.example).`
  );
  process.exit(1);
}

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

  if (/[Xx]/.test(phoneStr)) {
    const match = digitsOnly.match(/^(\d{6})/);
    return match ? `+1${match[1]}` : null;
  }
  if (digitsOnly.length === 10) return `+1${digitsOnly}`;
  if (digitsOnly.length === 11 && digitsOnly.startsWith("1")) return `+${digitsOnly}`;
  if (digitsOnly.length === 6) return `+1${digitsOnly}`;
  if (digitsOnly.length === 11 && !digitsOnly.startsWith("1")) return `+1${digitsOnly}`;
  return null;
}

function formatCallGridPhoneNumber(phoneNumber) {
  if (!phoneNumber) return null;

  const original = phoneNumber.toString().trim();

  // masked number
  if (/[Xx]/.test(original)) {
    const digits = original.replace(/\D/g, "");

    if (digits.length >= 6) {
      return digits.substring(0, 6);
    }

    return null;
  }

  let digitsOnly = original.replace(/\D/g, "");

  // already 11 digit with country code
  if (
    digitsOnly.length === 11 &&
    digitsOnly.startsWith("1")
  ) {
    return digitsOnly;
  }

  // normal 10 digit
  if (digitsOnly.length === 10) {
    return digitsOnly;
  }

  // fallback
  return digitsOnly;
}
function normalizeKey(key) {
  return key.toString().trim().toLowerCase().replace(/\s+/g, "");
}

function cleanAmount(value) {
  if (!value) return 0;
  return parseFloat(value.toString().replace(/[^0-9.]/g, "")) || 0;
}

// Accepts Yes/No, true/false, 1/0, y/n (case-insensitive). Returns undefined if the
// column is blank/missing so we don't touch conversion status when it wasn't provided.
function parseConverted(value) {
  if (value === undefined || value === null || value.toString().trim() === "") {
    return undefined;
  }
  const normalized = value.toString().trim().toLowerCase();
  if (["yes", "y", "true", "1"].includes(normalized)) return true;
  if (["no", "n", "false", "0"].includes(normalized)) return false;
  return undefined;
}

// ==================== RINGBA FUNCTIONS ====================
async function ringbaGetInboundCallIds(phoneNumber, targetName, reportStart, reportEnd, checkHasPayout = false) {
  try {
    console.log(`[Ringba] Fetch: ${phoneNumber}, Target: ${targetName}, CheckPayout: ${checkHasPayout}`);

    const filters = [
      {
        anyConditionToMatch: [{
          column: "inboundPhoneNumber",
          value: phoneNumber,
          isNegativeMatch: false,
          comparisonType: "BEGINS_WITH",
        }],
      },
      {
        anyConditionToMatch: [{
          column: "targetName",
          value: targetName,
          isNegativeMatch: false,
          comparisonType: "EQUALS",
        }],
      },
    ];

    if (checkHasPayout) {
      filters.push({
        anyConditionToMatch: [{
          column: "payoutAmount",
          value: "0",
          isNegativeMatch: false,
          comparisonType: "GREATER_THAN",
        }],
      });
    }

    const response = await axios.post(
      `${RINGBA_API_BASE}/calllogs`,
      { reportStart, reportEnd, filters },
      { headers: { Authorization: `Token ${RINGBA_AUTH_TOKEN}`, "Content-Type": "application/json" }, timeout: 30000 }
    );

    const records = response.data.report?.records || [];

    if (records.length === 0) {
      return { success: true, callIds: [], noRecords: true };
    }

    if (records.length === 1) {
      return { success: true, callIds: [records[0].inboundCallId] };
    }

    let longestCall = records[0];
    for (const record of records) {
      if ((record.connectedCallLengthInSeconds || 0) > (longestCall.connectedCallLengthInSeconds || 0)) {
        longestCall = record;
      }
    }

    return { success: true, callIds: [longestCall.inboundCallId], recordCount: records.length };
  } catch (error) {
    console.error(`[Ringba Error] ${phoneNumber}:`, error.response?.data || error.message);
    return { success: false, message: error.response?.data?.message || error.message };
  }
}

async function ringbaPostPaymentDetails(inboundCallId, revenue, payout) {
  try {
    await axios.post(
      `${RINGBA_API_BASE}/calls/payments/override`,
      {
        INBOUNDCALLID: inboundCallId,
        reason: "Call payments adjusted by acct. Admin.",
        adjustConversion: true,
        adjustPayout: true,
        newConversionAmount: revenue,
        newPayoutAmount: payout,
      },
      { headers: { Authorization: `Token ${RINGBA_AUTH_TOKEN}` }, timeout: 30000 }
    );
    console.log(`[Ringba] Payment posted: ${inboundCallId}`);
    return { success: true };
  } catch (error) {
    console.error(`[Ringba Payment Error] ${inboundCallId}:`, error.response?.data?.message || error.message);
    return { success: false };
  }
}

// ==================== CALLGRID FUNCTIONS ====================
async function callgridGetCallId(phoneNumber, targetName, startDate, endDate) {
  try {

    const searchPhone = formatCallGridPhoneNumber(phoneNumber);

    console.log(
      `[CallGrid] Fetch: ${searchPhone}, Destination: ${targetName}`
    );


    const requestBody = {
      startDate,
      endDate,

      filters: {
        items: [
          {
            operator: "OR",
            rules: [
              {
                tagName: "CallerId",
                values: [searchPhone],
                condition: "contains",
                customOptions: [],
                labelMap: {
                  [searchPhone]: ""
                }
              }
            ]
          }
        ]
      },

      permission: "",
      page: 0,
      maxItems: 500,

      sortColumn: "createdAt",
      sortDirection: "desc",

      reportTimeZone: "US/Eastern",
      outcomes: [],
      isSortFieldTag: false,
      useCursor: false
    };


    const response = await axios.post(
      `${CALLGRID_API_BASE}/call?organizationId=${CALLGRID_ORG_ID}`,
      requestBody,
      {
        headers: {
          Authorization: `Bearer ${CALLGRID_AUTH_TOKEN}`
        },
        timeout: 30000
      }
    );


    let records = response.data?.data || [];


    if (!records.length) {

      console.log(
        `[CallGrid] No records found`
      );

      return {
        success: true,
        callId: null,
        noRecords: true
      };

    }



    // ===========================
    // PHONE MATCH USING BEGINS WITH
    // ===========================

    const phoneMatches = records.filter((r) => {


      const callerId = (
        r.callerId ||
        r.CallerId ||
        r.phoneNumber ||
        r.inboundPhoneNumber ||
        ""
      )
        .toString()
        .replace(/\D/g, "");


      return callerId.startsWith(searchPhone);

    });



    if (!phoneMatches.length) {

      console.log(
        `[CallGrid] Phone not matched: ${searchPhone}`
      );


      return {
        success: true,
        callId: null,
        noRecords: true
      };

    }



    console.log(
      `[CallGrid] Phone matched ${phoneMatches.length} records`
    );



    // ===========================
    // DESTINATION NAME MATCH
    // ===========================

    const normalize = (value) => {

      return (value || "")
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[\s\-_]/g, "");

    };


    const wantedDestination =
      normalize(targetName);



    const destinationMatches =
      phoneMatches.filter((r) => {


        const destination =
          normalize(
            r.destinationName ||
            r.DestinationName
          );


        return (
          destination === wantedDestination ||
          destination.includes(wantedDestination) ||
          wantedDestination.includes(destination)
        );

      });



    if (!destinationMatches.length) {


      console.log(
        `[CallGrid] Phone matched but NO destinationName match.
  Wanted: ${targetName}

  Available:
  ${[
          ...new Set(
            phoneMatches.map(
              r =>
                r.destinationName ||
                r.DestinationName
            )
          )
        ].join(" | ")
        }`
      );


      return {
        success: true,
        callId: null,
        noRecords: true,
        destinationMismatch: true
      };

    }




    // ===========================
    // PICK LONGEST CALL
    // ===========================

    const getDuration = (rec) => {

      return Number(
        rec.duration ??
        rec.callDuration ??
        rec.talkTime ??
        rec.connectedCallLengthInSeconds ??
        rec.length ??
        0
      ) || 0;

    };



    let bestMatch = destinationMatches[0];


    for (const rec of destinationMatches) {

      if (
        getDuration(rec) >
        getDuration(bestMatch)
      ) {

        bestMatch = rec;

      }

    }

    console.log(
      `[CallGrid] Selected:
  ID: ${bestMatch.id}
  Phone: ${searchPhone}
  Destination: ${bestMatch.destinationName ||
      bestMatch.DestinationName
      }
  Duration: ${getDuration(bestMatch)} sec`
    );

    return {
      success: true,
      callId: bestMatch.id,
      callData: bestMatch,
      recordCount: destinationMatches.length

    };
  } catch (error) {
    console.error(
      `[CallGrid Error]`,
      error.response?.data ||
      error.message
    );
    return {
      success: false,
      message:
        error.response?.data?.message ||
        error.message
    };

  }
}

async function callgridUpdatePayout(callId, revenue, payout, converted) {
  try {

    const callFields = {
      Revenue: Number(revenue),
      Payout: Number(payout)
    };

    // Converted is optional - only send it when the report actually specifies it,
    // and send both a boolean and a Yes/No string since CallGrid's accepted
    // format for this field isn't documented.
    if (converted !== undefined) {
      callFields.Converted = converted;
      callFields.ConvertedStatus = converted ? "Yes" : "No";
    }

    const updateBody = {
      [callId]: callFields
    };

    console.log(
      "[CallGrid Update Body]",
      JSON.stringify(updateBody)
    );

    const response = await axios.patch(
      `${CALLGRID_API_BASE}/call?organizationId=${CALLGRID_ORG_ID}`,
      updateBody,
      {
        headers: {
          Authorization: `Bearer ${CALLGRID_AUTH_TOKEN}`,
          "Content-Type": "application/json"
        },
        timeout: 30000
      }
    );

    console.log(
      `[CallGrid] Payout updated: ${callId}` +
      (converted !== undefined ? `, Converted: ${converted}` : "")
    );

    return {
      success: true,
      response: response.data
    };

  } catch (error) {

    console.error(
      `[CallGrid Update Error] ${callId}:`,
      JSON.stringify(error.response?.data, null, 2) ||
      error.message
    );

    return {
      success: false,
      message:
        error.response?.data?.message ||
        error.message
    };
  }
}
// ==================== PROCESSING FUNCTION ====================
async function processFile(system, filePath, reportStart, reportEnd, processType) {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawData = XLSX.utils.sheet_to_json(sheet);

  const data = rawData.map((row) => {
    const newRow = {};
    for (const key in row) {
      newRow[normalizeKey(key)] = row[key];
    }
    return newRow;
  });

  console.log(`[${system}] Sample row:`, data[0]);

  const totalRecords = data.length;

  const BATCH_SIZE = system === "callgrid" ? 20 : 10;
  const delayBetweenBatches = system === "callgrid" ? 500 : 2000;

  const invalidRows = [];
  const noRecordFoundNumbers = [];
  const noPayoutRecords = [];
  const processedRecords = [];
  const failedRecords = [];

  const requiredColumns =
    system === "ringba"
      ? ["inboundphonenumber", "targetname", "revenue", "payout"]
      : ["inboundphonenumber", "targetname", "revenue", "payout"];

  const startDate = reportStart.split("T")[0];
  const endDate = reportEnd.split("T")[0];

  const batches = [];
  for (let i = 0; i < data.length; i += BATCH_SIZE) {
    batches.push(data.slice(i, i + BATCH_SIZE));
  }

  for (let i = 0; i < batches.length; i++) {
    console.log(
      `\n[${system}] Batch ${i + 1}/${batches.length}`
    );

    for (let j = 0; j < batches[i].length; j++) {
      const row = batches[i][j];
      const rowIndex = i * BATCH_SIZE + j + 1;

      const phoneNumber = formatPhoneNumber(row.inboundphonenumber);
      const revenue = cleanAmount(row.revenue);
      const payout = cleanAmount(row.payout);
      const targetName = row.targetname;
      const converted = system === "callgrid" ? parseConverted(row.converted) : undefined;
      if (!phoneNumber || revenue === null || payout === null) {
        invalidRows.push({
          rowIndex,
          row,
          error: "Invalid or missing required data",
        });
        continue;
      }

      if (!targetName) {
        invalidRows.push({ rowIndex, row, error: "Missing targetName" });
        continue;
      }

      if (processType === "withPayout" && payout <= 0) {
        noPayoutRecords.push(phoneNumber);
        continue;
      }

      try {
        let result;

        // ======================
        // RINGBA FLOW
        // ======================
        if (system === "ringba") {
          result = await ringbaGetInboundCallIds(
            phoneNumber,
            targetName,
            reportStart,
            reportEnd,
            processType === "withPayout"
          );

          if (result.success && result.callIds?.length) {
            let ok = true;

            for (const callId of result.callIds) {
              const res = await ringbaPostPaymentDetails(
                callId,
                revenue,
                payout
              );
              if (!res.success) ok = false;
            }

            if (ok) {
              processedRecords.push({
                rowIndex,
                phoneNumber,
                status: "Processed",
              });
            } else {
              failedRecords.push({
                rowIndex,
                phoneNumber,
                error: "Ringba update failed",
              });
            }
          } else if (result.noRecords) {
            noRecordFoundNumbers.push(phoneNumber);
          } else {
            failedRecords.push({
              rowIndex,
              phoneNumber,
              error: result.message,
            });
          }
        }

        // ======================
        // CALLGRID FLOW (CLEAN)
        // ======================
        else {
          result = await callgridGetCallId(
            phoneNumber,
            targetName,
            startDate,
            endDate
          );

          if (result.success && result.callId) {
            const updateResult = await callgridUpdatePayout(
              result.callId,
              revenue,
              payout,
              converted
            );

            if (updateResult.success) {
              processedRecords.push({
                rowIndex,
                phoneNumber,
                callId: result.callId,
                converted: converted === undefined ? null : converted,
                status: "Processed",
              });
            } else {
              failedRecords.push({
                rowIndex,
                phoneNumber,
                error: updateResult.message,
              });
            }
          } else if (result.noRecords) {
            noRecordFoundNumbers.push(phoneNumber);
          } else {
            failedRecords.push({
              rowIndex,
              phoneNumber,
              error: result.message,
            });
          }
        }
      } catch (err) {
        failedRecords.push({
          rowIndex,
          phoneNumber,
          error: err.message,
        });
      }
    }

    // ⚡ controlled delay between batches
    if (i < batches.length - 1) {
      console.log(`[${system}] Waiting ${delayBetweenBatches}ms...`);
      await delay(delayBetweenBatches);
    }
  }

  return {
    total: totalRecords,
    processed: processedRecords.length,
    failed: failedRecords.length,
    skippedNoPayout: noPayoutRecords.length,
    invalidRows,
    noRecordFoundNumbers,
    noPayoutRecords,
    failedRecords,
    processedRecords,
  };
}

// ==================== API ENDPOINTS ====================
app.post("/upload", upload.single("file"), async (req, res) => {
  const { reportStart, reportEnd, processType, system } = req.body;
  const filePath = req.file?.path;

  if (!filePath) {
    return res.status(400).json({ success: false, message: "No file uploaded." });
  }

  if (!system || (system !== "ringba" && system !== "callgrid")) {
    return res.status(400).json({ success: false, message: "Invalid system selection. Choose 'ringba' or 'callgrid'." });
  }

  try {
    console.log(`\n========== Processing with ${system.toUpperCase()} ==========`);
    console.log(`Start: ${reportStart}, End: ${reportEnd}, Type: ${processType}`);

    const summary = await processFile(system, filePath, reportStart, reportEnd, processType);

    fs.unlinkSync(filePath);

    const processTypeLabel = processType === "withPayout"
      ? "Processed with hasPayout check (only positive payout)"
      : "Processed all records";

    return res.json({
      success: true,
      message: `${system.toUpperCase()} processing complete`,
      system: system,
      processType: processTypeLabel,
      summary: {
        total: summary.total,
        processed: summary.processed,
        failed: summary.failed,
        skippedNoPayout: summary.skippedNoPayout,
        batches: Math.ceil(summary.total / (system === "callgrid" ? 20 : 10))
      },
      invalidRows: summary.invalidRows,
      noRecordFoundNumbers: summary.noRecordFoundNumbers,
      noPayoutRecords: summary.noPayoutRecords,
      failedRecords: summary.failedRecords
    });
  } catch (error) {
    console.error("Processing error:", error);
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return res.status(500).json({ success: false, message: "File processing error: " + error.message });
  }
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Serve static files
app.use(express.static(path.join(__dirname, 'frontend/build')));
app.get(/^\/(?!api).*$/, (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend/build', 'index.html'));
});

app.use("/uploads", express.static(path.join(__dirname, UPLOAD_DIR)));

const PORT = process.env.PORT || 6002;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
