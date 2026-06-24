import "dotenv/config";
import { getRecordMetadata, getTableRows, postTableRows, patchTableRows } from "./services/ace-api.js";
import { parseTableField, buildTableRows, computeAsFoundRow, computeAsLeftRow } from "./utils/table-helpers.js";

const TABLE_MAP = [
  {
    label: "As Found Data",
    parentField: "cf_as_found_data_table",
    get fieldId() { return process.env.AS_FOUND_DATA_TABLE_ID; },
  },
  {
    label: "As Left Data",
    parentField: "cf_as_left_data_table",
    get fieldId() { return process.env.AS_LEFT_DATA_TABLE_ID; },
  },
  {
    label: "Manufacture Range and Calibration Tolerance",
    parentField: "cf_manufacture_range_calibration_tolerance",
    get fieldId() { return process.env.MANUFACTURE_AND_CALIBRATION_DATA_TABLE_ID; },
  },
  {
    label: "Calibration Range and Tolerance",
    parentField: "cf_calibration_range_tolerance",
    get fieldId() { return process.env.CALIBRATION_RANGE_TOLERANCE_DATA_TABLE_ID; },
  },
  {
    label: "Equipment Pricing",
    parentField: "cf_equipment_pricing",
    get fieldId() { return process.env.EQUIPMENT_PRICING_DATA_TABLE_ID; },
  },
];

const CALC_TABLES = [
  {
    label: "As Found Data",
    get fieldId() { return process.env.AS_FOUND_DATA_TABLE_ID; },
    computeFn: computeAsFoundRow,
  },
  {
    label: "As Left Data",
    get fieldId() { return process.env.AS_LEFT_DATA_TABLE_ID; },
    computeFn: computeAsLeftRow,
  },
];

async function runCalculations(recordId) {
  console.log(`[${new Date().toISOString()}] Starting calculations for asset record: ${recordId}`);

  for (const table of CALC_TABLES) {
    let tableData;
    try {
      tableData = await getTableRows(recordId, table.fieldId);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] ERROR: Failed to fetch "${table.label}" from record ${recordId}: ${err.message}`);
      continue;
    }

    const rows = tableData?.data;
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      console.warn(`[${new Date().toISOString()}] WARN: No rows found for "${table.label}" — skipping.`);
      continue;
    }

    const updatedRows = rows.map((row) => ({
      type: "record-table-row",
      name: row.name,
      attributes: table.computeFn(row.values ?? {}),
    }));

    try {
      await patchTableRows(recordId, table.fieldId, updatedRows);
      console.log(`[${new Date().toISOString()}] OK: Patched ${updatedRows.length} row(s) on "${table.label}" (field ID ${table.fieldId}) for record ${recordId}.`);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] ERROR: Failed to patch "${table.label}" on record ${recordId}: ${err.message}`);
    }
  }

  console.log(`[${new Date().toISOString()}] Calculations complete for asset record: ${recordId}`);
}

async function runMigration(childRecordId) {
  console.log(`[${new Date().toISOString()}] Starting migration for child record: ${childRecordId}`);

  let childRecord;
  try {
    childRecord = await getRecordMetadata(childRecordId);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ERROR: Failed to fetch child record ${childRecordId}: ${err.message}`);
    process.exit(1);
  }

  const parentRecordId = childRecord?.attributes?.cf_parent_record ?? childRecord?.attributes?.cf_parent_asset ?? childRecord?.attributes?.cf_asset_id;
  if (!parentRecordId) {
    console.error(`[${new Date().toISOString()}] ERROR: Child record ${childRecordId} has no cf_parent_record, cf_parent_asset, or cf_asset_id field.`);
    process.exit(1);
  }

  console.log(`[${new Date().toISOString()}] Resolved parent record: ${parentRecordId}`);

  let parentRecord;
  try {
    parentRecord = await getRecordMetadata(parentRecordId);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ERROR: Failed to fetch parent record ${parentRecordId}: ${err.message}`);
    process.exit(1);
  }

  const parentAttrs = parentRecord?.attributes ?? {};

  for (const table of TABLE_MAP) {
    const rawValue = parentAttrs[table.parentField];

    if (!rawValue) {
      console.warn(`[${new Date().toISOString()}] WARN: Parent field "${table.parentField}" is empty — skipping "${table.label}".`);
      continue;
    }

    const parsedRows = parseTableField(rawValue);

    if (parsedRows.length === 0) {
      console.warn(`[${new Date().toISOString()}] WARN: No rows parsed from "${table.parentField}" — skipping "${table.label}".`);
      continue;
    }

    const rows = buildTableRows(parsedRows);

    try {
      await postTableRows(childRecordId, table.fieldId, rows);
      console.log(`[${new Date().toISOString()}] OK: Posted ${rows.length} row(s) to "${table.label}" (field ID ${table.fieldId}) on child record ${childRecordId}.`);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] ERROR: Failed to post "${table.label}" to child record ${childRecordId}: ${err.message}`);
    }
  }

  console.log(`[${new Date().toISOString()}] Migration complete for child record: ${childRecordId}`);
}

export async function run(recordId, projectId) {
  if (!recordId) {
    console.error(`[${new Date().toISOString()}] ERROR: recordId argument is required. Usage: node index.js <recordId> <projectId>`);
    process.exit(1);
  }

  await runMigration(recordId);
  await runCalculations(recordId);
}

const isMain = process.argv[1] && (
  process.argv[1].endsWith("index.js") || process.argv[1].endsWith("index")
);

if (isMain) {
  run(process.argv[2], process.argv[3]);
}
