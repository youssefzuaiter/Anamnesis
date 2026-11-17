import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";

/**
 * A PDF imported through the browser keeps its page markers, so its note offers "Ask about this paper", and an ordinary note does not.
 * (The page of each citation is checked in tests/integration/pdf-pages.test.ts and by the page-reference eval with the real embedder.)
 */

const main = (page: Page) => page.locator("main");

/** A two-page PDF with a line of text on each page, written by hand so the test needs no fixture file. */
function twoPagePdf(): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 7 0 R >> >> >>",
    "STREAM1",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >>",
    "STREAM2",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = (text: string) => {
    const body = `BT /F1 14 Tf 20 100 Td (${text}) Tj ET`;
    return `<< /Length ${body.length} >>\nstream\n${body}\nendstream`;
  };
  objects[3] = stream("Gradient descent on the first page of the paper");
  objects[5] = stream("Photosynthesis on the second page of the paper");
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

const noteIds: string[] = [];
test.afterEach(async () => {
  if (!noteIds.length) return;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(`DELETE FROM "Note" WHERE id = ANY($1)`, [noteIds]);
  await client.end();
  noteIds.length = 0;
});

test("an imported PDF offers 'Ask about this paper' and shows its page markers; a plain note does not", async ({ page }) => {
  await page.goto("/notes/import");
  await main(page).getByLabel("PDF file").setInputFiles( { name: "paper.pdf", mimeType: "application/pdf", buffer: twoPagePdf() });
  await main(page).getByLabel("Note title override").fill(`Paper ${Date.now()}`);
  await main(page).getByRole("button", { name: "Import PDF", exact: true }).click();
  await page.waitForURL(/\/notes\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  noteIds.push(page.url().split("/").pop()!);

  await expect(main(page)).toContainText("Gradient descent on the first page");
  await expect(main(page)).toContainText("1 of 2");
  await expect(main(page).getByRole("link", { name: "Ask about this paper" })).toBeVisible();
  await expect(main(page).getByRole("link", { name: "Ask about this note" })).toHaveCount(0);

  await page.goto("/notes/new");
  await page.fill('input[name="title"]', `Plain ${Date.now()}`);
  await page.locator('textarea[name="content"]').fill("Just my own words.");
  await main(page).getByRole("button", { name: "Create note" }).click();
  await page.waitForURL(/\/notes\/[0-9a-f-]{36}$/);
  noteIds.push(page.url().split("/").pop()!);
  await expect(main(page).getByRole("link", { name: "Ask about this note" })).toBeVisible();
  await expect(main(page).getByRole("link", { name: "Ask about this paper" })).toHaveCount(0);
});
