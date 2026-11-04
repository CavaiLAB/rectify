import ExcelJS from "exceljs";
import type { Issue } from "../shared/types.ts";

// 将时间戳换成上海日历日期，再以 Excel 日期值保存，避免浏览器所在时区改变日期。
export function exportDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  return new Date(Date.UTC(part("year"), part("month") - 1, part("day")));
}

export function createIssueWorkbook(
  issues: Issue[],
  projectName: string,
  now = new Date(),
) {
  const book = new ExcelJS.Workbook();
  book.creator = "Rectify";
  book.created = now;
  const sheet = book.addWorksheet("问题整改清单", {
    views: [{ state: "frozen", ySplit: 5, showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: "5:5",
      margins: {
        left: 0.25,
        right: 0.25,
        top: 0.35,
        bottom: 0.35,
        header: 0.15,
        footer: 0.15,
      },
    },
    headerFooter: { oddFooter: "&C第 &P 页 / 共 &N 页" },
  });
  const navy = "203B54",
    ink = "22374B",
    line = "DCE5ED";
  const widths = [9, 25, 12, 42, 44, 16, 14, 14, 12, 12];
  sheet.columns = widths.map((width) => ({ width }));
  sheet.mergeCells("A1:J1");
  sheet.getCell("A1").value = `${projectName} · 问题整改清单`;
  sheet.getCell("A1").font = {
    name: "Microsoft YaHei",
    size: 17,
    bold: true,
    color: { argb: navy },
  };
  sheet.getCell("A1").alignment = { vertical: "middle", wrapText: true };
  sheet.getRow(1).height = 36;
  sheet.getRow(2).height = 8;
  sheet.getRow(3).values = [
    "合计",
    issues.length,
    "已关闭",
    issues.filter((i) => i.status === "已关闭").length,
    "导出日期",
    exportDate(now.toISOString()),
  ];
  sheet.getCell("F3").numFmt = "yyyy-mm-dd";
  sheet.getRow(3).height = 26;
  sheet.getRow(3).eachCell((cell) => {
    cell.font = { name: "Microsoft YaHei", size: 11, color: { argb: ink } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "F3F7FB" },
    };
  });
  sheet.getRow(4).height = 8;
  sheet.getRow(5).values = [
    "编号",
    "功能项",
    "类型",
    "问题 / 新增功能",
    "整改措施",
    "责任人",
    "整改日期",
    "完成日期",
    "状态",
    "复验结果",
  ];
  sheet.getRow(5).height = 28;
  sheet.getRow(5).eachCell((cell) => {
    cell.font = {
      name: "Microsoft YaHei",
      size: 11,
      bold: true,
      color: { argb: "FFFFFF" },
    };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: navy } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = { right: { style: "thin", color: { argb: "FFFFFF" } } };
  });
  for (const [index, issue] of issues.entries()) {
    const detail =
      issue.description.trim() === issue.title.trim()
        ? issue.title
        : `${issue.title}\n${issue.description}`;
    const row = sheet.addRow([
      `#${String(issue.number).padStart(3, "0")}`,
      issue.feature_name,
      issue.type,
      detail,
      issue.resolution,
      issue.assignee_name || "未分配",
      exportDate(issue.completed_at),
      issue.status === "已关闭" ? exportDate(issue.closed_at) : null,
      issue.status,
      issue.verification,
    ]);
    let lines = 1;
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.font = { name: "Microsoft YaHei", size: 11, color: { argb: ink } };
      cell.alignment = {
        vertical: "middle",
        wrapText: true,
        horizontal: [1, 3, 6, 7, 8, 9, 10].includes(col) ? "center" : "left",
      };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: index % 2 ? "F3F7FB" : "FFFFFF" },
      };
      cell.border = { bottom: { style: "thin", color: { argb: line } } };
      if (typeof cell.value === "string") {
        const count = cell.value
          .split("\n")
          .reduce(
            (n, text) =>
              n +
              Math.max(
                1,
                Math.ceil(
                  [...text].reduce(
                    (size, char) => size + (char.charCodeAt(0) > 255 ? 2 : 1),
                    0,
                  ) /
                    (widths[col - 1] - 2),
                ),
              ),
            0,
          );
        lines = Math.max(lines, count);
      }
    });
    row.height = Math.min(409, Math.max(34, lines * 16 + 10));
    for (const col of [7, 8]) row.getCell(col).numFmt = "yyyy-mm-dd";
    if (issue.status === "已关闭") {
      row.getCell(9).font = {
        name: "Microsoft YaHei",
        size: 11,
        bold: true,
        color: { argb: "2B6C55" },
      };
      row.getCell(9).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "EAF5EF" },
      };
    }
  }
  sheet.autoFilter = `A5:J${Math.max(5, issues.length + 5)}`;
  sheet.pageSetup.printArea = `A1:J${Math.max(5, issues.length + 5)}`;
  return book;
}

export async function downloadIssueWorkbook(
  issues: Issue[],
  projectName: string,
) {
  const buffer = await createIssueWorkbook(
    issues,
    projectName,
  ).xlsx.writeBuffer();
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(buffer)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `${projectName.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")}_问题整改清单.xlsx`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
