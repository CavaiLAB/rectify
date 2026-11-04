import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { createIssueWorkbook, exportDate } from "../src/exportIssues.ts";
import type { Issue } from "../shared/types.ts";

const issue: Issue = {
  id: "test",
  number: 7,
  project_id: "project",
  feature_id: "feature",
  feature_name: "虚构报表",
  title: "=1+1",
  description: '=HYPERLINK("https://invalid.example")',
  type: "新增功能",
  status: "已关闭",
  priority: "普通",
  assignee_id: "tester",
  assignee_name: "虚构责任人完整姓名",
  due_date: "",
  resolution: "已完成日期筛选",
  verification: "通过",
  completed_at: "2026-11-02T16:30:00Z",
  closed_at: "2026-11-03T16:30:00Z",
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-04T06:00:00Z",
  version: 1,
  attachment_count: 0,
  source_system: null,
  reporter_name: null,
  source_path: null,
};

test("xlsx保留真实状态、完整责任人及上海日期，用户文本不变成公式", async () => {
  const input = [
    issue,
    {
      ...issue,
      id: "pending",
      number: 8,
      status: "待处理" as const,
      verification: "未复验" as const,
      assignee_name: null,
      completed_at: null,
      closed_at: null,
    },
  ];
  const buffer = await createIssueWorkbook(
    input,
    "虚构项目",
  ).xlsx.writeBuffer();
  const read = new ExcelJS.Workbook();
  await read.xlsx.load(buffer);
  const s = read.worksheets[0];
  assert.equal(s.getCell("B3").value, 2);
  assert.equal(s.getCell("D3").value, 1);
  assert.equal(s.getCell("F6").value, issue.assignee_name);
  assert.equal(s.getCell("F7").value, "未分配");
  assert.equal(s.getCell("D6").type, ExcelJS.ValueType.String);
  assert.equal(s.getCell("D6").formula, undefined);
  assert.match(String(s.getCell("D6").value), /^=1\+1/);
  assert.equal(
    (s.getCell("G6").value as Date).toISOString(),
    "2026-11-03T00:00:00.000Z",
  );
  assert.equal(
    (s.getCell("H6").value as Date).toISOString(),
    "2026-11-04T00:00:00.000Z",
  );
  assert.equal(s.getCell("G6").numFmt, "yyyy-mm-dd");
  assert.equal(s.getCell("H7").value, null);
  assert.equal(s.getCell("I7").value, "待处理");
  assert.equal(s.pageSetup.printTitlesRow, "5:5");
  assert.equal(s.views[0].state, "frozen");
});

test("导出只包含传入筛选结果，空清单与无效日期可处理", async () => {
  const filtered = createIssueWorkbook([issue], "筛选后项目").worksheets[0];
  assert.equal(filtered.getCell("A6").value, "#007");
  assert.equal(filtered.getCell("A7").value, null);
  assert.equal(
    createIssueWorkbook([], "空项目").worksheets[0].getCell("B3").value,
    0,
  );
  assert.equal(exportDate(null), null);
  assert.equal(exportDate("invalid"), null);
  assert.equal(
    exportDate("2026-11-04")?.toISOString(),
    "2026-11-04T00:00:00.000Z",
  );
});
