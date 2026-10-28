import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeIssueTitle } from "../server/issue-title.ts";

test("从问题描述提取关键句，略去问候和格式标记", () => {
  assert.equal(
    summarizeIssueTitle("您好，环样性能页面保存失败。重新进入后数据为空。"),
    "环样性能页面保存失败",
  );
  assert.equal(
    summarizeIssueTitle("问题描述：导出报表缺少最后一列"),
    "导出报表缺少最后一列",
  );
  assert.equal(
    summarizeIssueTitle(
      "操作步骤：\n1. 打开报表页面\n2. 点击导出\n实际结果：导出失败，提示格式错误。\n预期结果：下载成功",
    ),
    "导出失败，提示格式错误",
  );
});
test("保留需求与否定词，不推测未描述的结论", () => {
  assert.equal(
    summarizeIssueTitle("希望增加按月份导出报表的功能。方便每月核对。"),
    "希望增加按月份导出报表的功能",
  );
  assert.equal(
    summarizeIssueTitle("没有报错，但页面数据没有更新。"),
    "没有报错，但页面数据没有更新",
  );
  assert.equal(summarizeIssueTitle("页面文字太小"), "页面文字太小");
});
test("英文、空白、换行与版本号处理", () => {
  assert.equal(
    summarizeIssueTitle("Export fails on version 1.2.3. Please investigate."),
    "Export fails on version 1.2.3",
  );
  assert.equal(
    summarizeIssueTitle("  \t页面   数据异常  \n附图如下"),
    "页面 数据异常",
  );
  assert.equal(summarizeIssueTitle(""), "问题反馈");
  assert.equal(summarizeIssueTitle("。！？"), "问题反馈");
});
test("长描述生成有限长度标题且不截断组合emoji", () => {
  const title = summarizeIssueTitle("导出失败：" + "👨‍👩‍👧‍👦".repeat(80));
  const segments = Array.from(
    new Intl.Segmenter("zh-CN", { granularity: "grapheme" }).segment(title),
  );
  assert(segments.length <= 48);
  assert(title.length <= 120);
  assert(title.endsWith("…"));
  assert(!title.includes("\ufffd"));
  assert(segments.slice(6, -1).every((part) => part.segment === "👨‍👩‍👧‍👦"));
});
