import "dotenv/config";
import { getRecordMetadata, postTableRows } from "./services/ace-api.js";
import { parseTableField, buildTableRows } from "./utils/table-helpers.js";

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
];

export async function run(childRecordId, projectId) {
  if (!childRecordId) {
    console.error(`[${new Date().toISOString()}] ERROR: childRecordId argument is required. Usage: node index.js <childRecordId> <projectId>`);
    process.exit(1);
  }

  console.log(`[${new Date().toISOString()}] Starting migration for child record: ${childRecordId} (project: ${projectId})`);

  // 1. Fetch child record to get parent record ID
  let childRecord;
  try {
    childRecord = await getRecordMetadata(childRecordId);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ERROR: Failed to fetch child record ${childRecordId}: ${err.message}`);
    process.exit(1);
  }

  const parentRecordId = childRecord?.attributes?.cf_parent_record;
  if (!parentRecordId) {
    console.error(`[${new Date().toISOString()}] ERROR: Child record ${childRecordId} has no cf_parent_record field.`);
    process.exit(1);
  }

  console.log(`[${new Date().toISOString()}] Resolved parent record: ${parentRecordId}`);

  // 2. Fetch parent record metadata
  let parentRecord;
  try {
    parentRecord = await getRecordMetadata(parentRecordId);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ERROR: Failed to fetch parent record ${parentRecordId}: ${err.message}`);
    process.exit(1);
  }

  const parentAttrs = parentRecord?.attributes ?? {};

  // 3. For each table: parse parent data, build rows, POST to child
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

// Auto-run when invoked directly via CLI
const isMain = process.argv[1] && (
  process.argv[1].endsWith("index.js") || process.argv[1].endsWith("index")
);

if (isMain) {
  run(process.argv[2], process.argv[3]);
}
