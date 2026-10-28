import { test, expect } from "@playwright/test";
import sharp from "sharp";
test("项目、功能项、新需求、图片、整改、复验关闭与刷新持久化", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("账号", { exact: true }).fill("tester");
  await page.getByLabel("密码", { exact: true }).fill("browser-test-only-2026");
  await page.getByRole("button", { name: "登录工作台" }).click();
  await expect(
    page.getByRole("heading", { name: "让项目问题，有序推进。" }),
  ).toBeVisible();
  await page
    .getByRole("main")
    .getByRole("button", { name: "创建项目", exact: true })
    .click();
  const name = `示例项目-${testInfo.project.name}`;
  await page.getByLabel("项目名称 *", { exact: true }).fill(name);
  await page
    .getByLabel("项目说明", { exact: true })
    .fill("虚构示例，用于检查整改闭环。");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "创建项目", exact: true })
    .click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "登记问题", exact: true }).click();
  await page
    .getByLabel("问题标题 *", { exact: true })
    .fill("增加按月份导出报表");
  await page.getByRole("button", { name: "没有合适的？添加功能项" }).click();
  await page.getByLabel("新功能项名称").fill("报表管理");
  await page.getByRole("button", { name: "添加并选择" }).click();
  await page.getByLabel("问题类型 *", { exact: true }).selectOption("新增功能");
  await page
    .getByLabel("问题描述 *", { exact: true })
    .fill("希望按月份选择数据并导出，用于每月核对。");
  await page
    .getByLabel("责任人", { exact: true })
    .selectOption({ label: "验收成员" });
  const buffer = await sharp({
    create: { width: 320, height: 180, channels: 3, background: "#176958" },
  })
    .png()
    .toBuffer();
  await page
    .getByLabel("上传图片")
    .setInputFiles({ name: "sample.png", mimeType: "image/png", buffer });
  await expect(page.getByAltText("sample.png")).toBeVisible();
  await page.getByRole("button", { name: "提交问题", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "#001 增加按月份导出报表" }).click();
  await expect(page.getByAltText("sample.png")).toBeVisible();
  await page
    .getByLabel("整改措施 / 处理说明")
    .fill("已增加月份筛选和导出入口，请按相同月份复验。");
  await page.getByLabel("处理状态", { exact: true }).selectOption("待复验");
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "#001 增加按月份导出报表" }).click();
  await page.getByLabel("复验结果", { exact: true }).selectOption("通过");
  await page.getByLabel("处理状态", { exact: true }).selectOption("已关闭");
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("tbody")).toContainText("已关闭");
  await page.reload();
  await page.getByRole("button", { name: `进入项目 ${name}` }).click();
  await expect(page.locator("tbody")).toContainText("增加按月份导出报表");
  await expect(page.locator("tbody")).toContainText("已关闭");
  await page.getByRole("button", { name: "#001 增加按月份导出报表" }).click();
  await expect(page.getByLabel("整改措施 / 处理说明")).toHaveValue(
    "已增加月份筛选和导出入口，请按相同月份复验。",
  );
  await expect(page.getByAltText("sample.png")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("issue-detail.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "关闭弹窗" }).click();
  await page.getByLabel("搜索问题").fill("不存在的关键词");
  await expect(page.getByText("没有符合条件的问题")).toBeVisible();
  await page.getByLabel("搜索问题").fill("");
  await page.screenshot({
    path: testInfo.outputPath("workspace.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
});
