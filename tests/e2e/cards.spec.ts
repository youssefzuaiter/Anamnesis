import { randomUUID } from "node:crypto";
import { test, expect, type Locator, type Page } from "@playwright/test";

/** Assertions read `main`, never `body` (see workspace.spec.ts for why). */
function main(page: Page) {
  return page.locator("main");
}

/** Creates a note through the form, in a course if one is named by its code, and returns its address. */
async function makeNote(page: Page, title: string, content: string, courseCode?: string): Promise<string> {
  await page.goto("/notes/new");
  await page.fill('input[name="title"]', title);
  await page.fill('textarea[name="content"]', content);
  if (courseCode) {
    const value = await page
      .locator('select[name="courseId"] option', { hasText: courseCode })
      .first()
      .getAttribute("value");
    await page.selectOption('select[name="courseId"]', value!);
  }
  await main(page).getByRole("button", { name: /create note/i }).click();
  await page.waitForURL(/\/notes\/[0-9a-f-]{36}$/);
  return page.url();
}

const newCard = (page: Page) => main(page).getByRole("button", { name: "New card", exact: true });
const dialog = (page: Page) => page.getByRole("dialog", { name: "New card" });
const tray = (page: Page) => page.getByRole("group", { name: "Make a card from the selection" });
const added = (page: Page) => main(page).getByRole("status").filter({ hasText: /^Added \d+ cards?\.$/ });
const textBox = (page: Page) => dialog(page).getByLabel("Text with blanks");

/**
 * Double-clicks a word the way a person would. Playwright cannot find "the word ATP", so
 * its position on screen is worked out from the text node holding it.
 */
async function dblclickWord(page: Page, word: string, within = "[data-note-body]") {
  const point = await page.evaluate(
    ({ word, within }) => {
      const root = document.querySelector(within);
      if (!root) return null;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = (node.textContent ?? "").indexOf(word);
        if (at === -1) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + word.length);
        const box = range.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }
      return null;
    },
    { word, within },
  );
  expect(point, `"${word}" is on the page inside ${within}`).not.toBeNull();
  await page.mouse.dblclick(point!.x, point!.y);
}

test("a card by hand: the text with blanks makes one card per number", async ({ page }) => {
  await makeNote(page, `Capitals ${Date.now()}`, "Notes on capitals.");

  await newCard(page).click();
  await expect(dialog(page)).toBeVisible();
  await textBox(page).fill("{{c1::Paris}} is the capital of {{c2::France}}");
  await expect(dialog(page)).toContainText("This makes 2 cards");

  await dialog(page).getByRole("button", { name: "Add 2 cards" }).click();

  await expect(dialog(page)).toBeHidden();
  await expect(added(page)).toHaveText("Added 2 cards.");
  await expect(main(page)).toContainText("2 cards from this note");
});

test("Hide selected words wraps the selection in the next number", async ({ page }) => {
  await makeNote(page, `Wrap ${Date.now()}`, "A note.");
  await newCard(page).click();

  const hide = dialog(page).getByRole("button", { name: "Hide selected words" });
  await textBox(page).fill("Paris is the capital of France");
  await expect(hide).toBeDisabled(); // nothing selected yet

  await textBox(page).press("Home");
  for (let i = 0; i < 5; i++) await textBox(page).press("Shift+ArrowRight");
  await expect(hide).toBeEnabled();
  await hide.click();
  await expect(textBox(page)).toHaveValue("{{c1::Paris}} is the capital of France");

  await textBox(page).press("End");
  for (let i = 0; i < 6; i++) await textBox(page).press("Shift+ArrowLeft");
  await hide.click();
  await expect(textBox(page)).toHaveValue("{{c1::Paris}} is the capital of {{c2::France}}");
  await expect(dialog(page)).toContainText("This makes 2 cards");
});

test("double-clicking a word in the note offers a blank, prefilled with its sentence", async ({ page }) => {
  await makeNote(page, `Cells ${Date.now()}`, "Mitochondria make ATP in the cell. They are small.");

  await dblclickWord(page, "ATP");
  await expect(tray(page)).toBeVisible();
  await tray(page).getByRole("button", { name: "Fill in the blank" }).click();

  await expect(textBox(page)).toHaveValue("Mitochondria make {{c1::ATP}} in the cell.");
  await dialog(page).getByRole("button", { name: "Add card" }).click();
  await expect(added(page)).toHaveText("Added 1 card.");
  await expect(tray(page)).toHaveCount(0);
});

test("question and answer from a selection puts the selection in the answer", async ({ page }) => {
  await makeNote(page, `Answer ${Date.now()}`, "Mitochondria make ATP in the cell.");

  await dblclickWord(page, "ATP");
  await tray(page).getByRole("button", { name: "Question and answer" }).click();

  const box = dialog(page);
  await expect(box.getByRole("radio", { name: "Question and answer" })).toBeChecked();
  await expect(box.getByLabel("Answer", { exact: true })).toHaveValue("ATP");
  await expect(box.getByLabel("Question", { exact: true })).toHaveValue("");
  const add = box.getByRole("button", { name: "Add card" });
  await expect(add).toBeDisabled();

  await box.getByLabel("Question", { exact: true }).fill("What do mitochondria make?");
  await expect(add).toBeEnabled();
  await add.click();
  await expect(added(page)).toHaveText("Added 1 card.");
  await expect(main(page)).toContainText("1 card from this note");
});

test("a selection in the note's title shows no tray, while one in its text does", async ({ page }) => {
  const stamp = Date.now();
  await makeNote(page, `Heading${stamp} words`, "Body text to select.");

  await dblclickWord(page, `Heading${stamp}`, "main h1");
  expect(await page.evaluate(() => window.getSelection()?.toString().trim())).toContain("Heading");
  await page.waitForTimeout(700); // a "nothing happens" check has to give it time to happen
  await expect(tray(page)).toHaveCount(0);

  // The control: the listener is alive, and a selection in the text does show it.
  await dblclickWord(page, "select");
  await expect(tray(page)).toBeVisible();
});

test("a formula in the selection appears once, as $...$", async ({ page }) => {
  await makeNote(page, `Area ${Date.now()}`, "The area is $\\pi r^2$ for a circle.");

  // Chrome's triple-click stops at an inline formula (it selects only the text after it), so
  // the whole paragraph is selected the way a drag from its start to its end would.
  await page.locator("[data-note-body] p").first().evaluate((paragraph) => {
    window.getSelection()?.selectAllChildren(paragraph);
  });
  await tray(page).getByRole("button", { name: "Question and answer" }).click();

  await expect(dialog(page).getByLabel("Answer", { exact: true })).toHaveValue(
    "The area is $\\pi r^2$ for a circle.",
  );
});

test("triple-clicking the last paragraph selects it, though the selection ends just past the note", async ({ page }) => {
  await makeNote(page, `Last ${Date.now()}`, "First paragraph.\n\nSecond paragraph to triple-click.");

  await page.getByText("Second paragraph to triple-click.").click({ clickCount: 3 });
  await tray(page).getByRole("button", { name: "Question and answer" }).click();

  await expect(dialog(page).getByLabel("Answer", { exact: true })).toHaveValue(
    "Second paragraph to triple-click.",
  );
});

test("braces written in a note are neutralised in the prefill and the card still saves", async ({ page }) => {
  await makeNote(page, `Braces ${Date.now()}`, "Use {{c1::x}} for blanks.");

  await dblclickWord(page, "blanks");
  await tray(page).getByRole("button", { name: "Fill in the blank" }).click();

  await expect(textBox(page)).toHaveValue("Use { {c1::x} } for {{c1::blanks}}.");
  await dialog(page).getByRole("button", { name: "Add card" }).click();
  await expect(added(page)).toHaveText("Added 1 card.");
});

test("a bad text is explained in the dialog, not saved", async ({ page }) => {
  await makeNote(page, `Bad ${Date.now()}`, "A note.");
  await newCard(page).click();

  await textBox(page).fill("No blanks in this text");
  await expect(dialog(page)).toContainText("Hide at least one part");
  await expect(dialog(page).getByRole("button", { name: /^Add/ })).toBeDisabled();

  await textBox(page).fill("{{c1::open and never closed");
  await expect(dialog(page)).toContainText("Write each hidden part as");
  await expect(dialog(page).getByRole("button", { name: /^Add/ })).toBeDisabled();
});

test("a double click on Add makes one set of cards", async ({ page }) => {
  await makeNote(page, `Twice ${Date.now()}`, "A note.");
  await newCard(page).click();
  await textBox(page).fill("The {{c1::heart}} pumps blood");

  await dialog(page).getByRole("button", { name: "Add card" }).dblclick();

  await expect(added(page)).toHaveText("Added 1 card.");
  await expect(main(page)).toContainText("1 card from this note");
  await expect(main(page)).not.toContainText("2 cards from this note");
});

for (const scheme of ["light", "dark"] as const) {
  test(`the tray and the dialog fit a phone in ${scheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 375, height: 812 });
    await makeNote(page, `Phone ${scheme} ${Date.now()}`, "Mitochondria make ATP in the cell.");

    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const inside = async (target: Locator, label: string) => {
      const box = await target.boundingBox();
      expect(box, label).not.toBeNull();
      expect(box!.x, `${label} left edge`).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, `${label} right edge`).toBeLessThanOrEqual(375);
      return box!;
    };
    const tall = async (target: Locator, label: string) => {
      expect((await inside(target, label)).height, `${label} height`).toBeGreaterThanOrEqual(44);
    };

    await dblclickWord(page, "ATP");
    await expect(tray(page)).toBeVisible();
    for (const button of await tray(page).getByRole("button").all()) await tall(button, "tray button");
    const trayBox = await inside(tray(page), "tray");
    const tabs = await page.getByRole("navigation", { name: "Primary" }).boundingBox();
    expect(trayBox.y + trayBox.height).toBeLessThanOrEqual(tabs!.y); // above the tab bar
    expect(await overflow()).toBeLessThanOrEqual(0);

    await tray(page).getByRole("button", { name: "Fill in the blank" }).click();
    await expect(dialog(page)).toBeVisible();
    await inside(dialog(page), "dialog");
    for (const button of await dialog(page).getByRole("button").all()) await tall(button, "dialog button");
    await tall(textBox(page), "text field");
    for (const label of await dialog(page).locator("label:has(input[type=radio])").all()) {
      await tall(label, "kind of card");
    }
    expect(await overflow()).toBeLessThanOrEqual(0);

    await dialog(page).getByRole("button", { name: "Cancel" }).click();
    await expect(dialog(page)).toBeHidden();
  });
}

// --- Decks and the review queue -------------------------------------------------------------

/** Makes a course and returns its id. */
async function makeCourse(page: Page, code: string): Promise<string> {
  await page.goto("/courses");
  await page.fill('input[name="code"]', code);
  await page.fill('input[name="title"]', `Title ${code}`);
  await main(page).getByRole("button", { name: /add course/i }).click();
  await main(page).getByRole("link", { name: new RegExp(code) }).click();
  await page.waitForURL(/\/courses\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop()!;
}

async function addBasic(page: Page, noteUrl: string, question: string, answer: string) {
  await page.goto(noteUrl);
  await newCard(page).click();
  await dialog(page).getByRole("radio", { name: "Question and answer" }).check();
  await dialog(page).getByLabel("Question", { exact: true }).fill(question);
  await dialog(page).getByLabel("Answer", { exact: true }).fill(answer);
  await dialog(page).getByRole("button", { name: "Add card" }).click();
  await expect(added(page)).toHaveText("Added 1 card.");
}

async function addCloze(page: Page, noteUrl: string, text: string) {
  await page.goto(noteUrl);
  await newCard(page).click();
  await textBox(page).fill(text);
  await dialog(page).getByRole("button", { name: /^Add/ }).click();
  await expect(added(page)).toHaveText(/^Added \d+ cards?\.$/);
}

const decks = (page: Page) => page.getByRole("navigation", { name: "Decks" });
const deckLink = (page: Page, name: string | RegExp) => decks(page).getByRole("link", { name });

/** How many cards a deck says are due, 0 if it is not listed. */
async function dueIn(page: Page, deck: string | RegExp): Promise<number> {
  await page.goto("/cards");
  const link = deckLink(page, deck);
  if ((await link.count()) === 0) return 0;
  return Number(/(\d+) due/.exec(await link.innerText())![1]);
}

test("each course is a deck with its own count, and choosing one limits the queue", async ({ page }) => {
  const s = Date.now();
  const [a, b] = [`AAA${s}`, `BBB${s}`];
  const idA = await makeCourse(page, a);
  await makeCourse(page, b);
  const noteA = await makeNote(page, `Deck A ${s}`, "Note in A.", a);
  const noteB = await makeNote(page, `Deck B ${s}`, "Note in B.", b);
  await addBasic(page, noteA, `Alpha one ${s}?`, "yes");
  await addBasic(page, noteA, `Alpha two ${s}?`, "yes");
  await addBasic(page, noteB, `Beta one ${s}?`, "yes");

  await page.goto("/cards");
  await expect(deckLink(page, new RegExp(a))).toContainText("2 due");
  await expect(deckLink(page, new RegExp(b))).toContainText("1 due");

  await deckLink(page, new RegExp(a)).click();
  await expect(page).toHaveURL(new RegExp(`/cards\\?course=${idA}$`));
  await expect(deckLink(page, new RegExp(a))).toHaveAttribute("aria-current", "page");
  await expect(main(page)).toContainText("1 of 2");
  await expect(main(page)).toContainText(`Alpha one ${s}?`);
  await expect(main(page)).not.toContainText(`Beta one ${s}?`);

  await main(page).getByRole("button", { name: "Show answer" }).click();
  await main(page).getByRole("button", { name: "Good", exact: true }).click();
  await expect(main(page)).toContainText(`Alpha two ${s}?`);
  await expect(main(page)).toContainText("2 of 2");
});

test("cards from a note with no course are in the No course deck", async ({ page }) => {
  const s = Date.now();
  const before = await dueIn(page, "No course");
  const note = await makeNote(page, `Loose ${s}`, "A note in no course.");
  await addBasic(page, note, `Loose question ${s}?`, "yes");

  expect(await dueIn(page, "No course")).toBe(before + 1);
  await deckLink(page, "No course").click();
  await expect(page).toHaveURL(/\/cards\?course=none$/);
  await expect(deckLink(page, "No course")).toHaveAttribute("aria-current", "page");
});

test("a course that is not yours is an empty deck, and a garbage value is all decks", async ({ page }) => {
  await page.goto(`/cards?course=${randomUUID()}`);
  await expect(main(page)).toContainText("Nothing due right now.");
  await expect(decks(page).locator("[aria-current]")).toHaveCount(0);

  await page.goto("/cards?course=abc");
  await expect(deckLink(page, /^All decks/)).toHaveAttribute("aria-current", "page");
  await page.goto("/cards?course=none&course=none");
  await expect(deckLink(page, /^All decks/)).toHaveAttribute("aria-current", "page");
});

test("a fill-in-the-blank card shows a blank, then the answer in place", async ({ page }) => {
  const s = Date.now();
  const code = `CLZ${s}`;
  const id = await makeCourse(page, code);
  const note = await makeNote(page, `Capitals ${s}`, "Note.", code);
  await addCloze(page, note, "{{c1::Paris}} is the capital of France");

  await page.goto(`/cards?course=${id}`);
  await expect(main(page)).toContainText("is the capital of France");
  await expect(main(page)).toContainText("[…]");
  await expect(main(page)).not.toContainText("Paris");

  await main(page).getByRole("button", { name: "Show answer" }).click();
  await expect(main(page)).toContainText("Paris is the capital of France");
  await expect(main(page)).not.toContainText("[…]");

  await main(page).getByRole("button", { name: "Good", exact: true }).click();
  await expect(main(page)).toContainText("That's the queue cleared.");
});

test("a hint replaces the dots", async ({ page }) => {
  const s = Date.now();
  const code = `HNT${s}`;
  const id = await makeCourse(page, code);
  const note = await makeNote(page, `Hints ${s}`, "Note.", code);
  await addCloze(page, note, "{{c1::Paris::a city}} is the capital of France");

  await page.goto(`/cards?course=${id}`);
  await expect(main(page)).toContainText("[a city]");
  await expect(main(page)).not.toContainText("[…]");
  await expect(main(page)).not.toContainText("Paris");
});

// The page's data refreshes after every grade, and the card just graded is no longer due. A
// session has to be the queue it started with, or the refresh shortens it under the review
// position: the next card is skipped, and the end of the session reads "Nothing due".
test("grading a card shows the next one, and the page refreshing does not skip or end the session", async ({ page }) => {
  const s = Date.now();
  const code = `SEQ${s}`;
  const id = await makeCourse(page, code);
  const note = await makeNote(page, `Sequence ${s}`, "Note.", code);
  for (const n of [1, 2, 3]) await addBasic(page, note, `Question number ${n} of ${s}?`, "yes");

  await page.goto(`/cards?course=${id}`);
  for (const n of [1, 2, 3]) {
    await expect(main(page)).toContainText(`${n} of 3`);
    await expect(main(page)).toContainText(`Question number ${n} of ${s}?`);
    await page.waitForTimeout(1200); // let any refresh of the page's data land
    await expect(main(page)).toContainText(`Question number ${n} of ${s}?`);
    await main(page).getByRole("button", { name: "Show answer" }).click();
    await main(page).getByRole("button", { name: "Good", exact: true }).click();
  }
  await expect(main(page)).toContainText("That's the queue cleared.");
  await page.waitForTimeout(1200);
  await expect(main(page)).toContainText("That's the queue cleared.");
  await expect(main(page)).not.toContainText("Nothing due right now.");
});

test("the second card from one text waits for the next session", async ({ page }) => {
  const s = Date.now();
  const code = `SIB${s}`;
  const id = await makeCourse(page, code);
  const note = await makeNote(page, `Heart ${s}`, "Note.", code);
  await addCloze(page, note, "The {{c1::heart}} pumps {{c2::blood}} around the body");

  await page.goto(`/cards?course=${id}`);
  await expect(main(page)).toContainText("1 of 1");
  await expect(main(page)).toContainText("1 more card from the same text waits for your next session.");
  await main(page).getByRole("button", { name: "Show answer" }).click();
  await main(page).getByRole("button", { name: "Good", exact: true }).click();
  await expect(main(page)).toContainText("That's the queue cleared.");

  await page.goto(`/cards?course=${id}`); // the other card is the session now
  await expect(main(page)).toContainText("1 of 1");
  await expect(main(page)).toContainText("[…]");
  await expect(main(page)).not.toContainText("waits for your next session");
});

test("trashing the note removes its cards from the deck and the queue, and restoring brings them back", async ({ page }) => {
  const s = Date.now();
  const code = `TRS${s}`;
  const title = `Doomed cards ${s}`;
  const id = await makeCourse(page, code);
  const note = await makeNote(page, title, "Delete me.", code);
  await addBasic(page, note, `Gone and back ${s}?`, "yes");

  await page.goto(`/cards?course=${id}`);
  await expect(main(page)).toContainText(`Gone and back ${s}?`);

  await page.goto(note);
  await main(page).getByRole("button", { name: /^edit$/i }).click();
  page.once("dialog", (confirm) => confirm.accept());
  await main(page).getByRole("button", { name: /delete/i }).click();
  await page.waitForURL(/\/notes$/);

  await page.goto(`/cards?course=${id}`);
  await expect(main(page)).toContainText("Nothing due right now.");
  await expect(deckLink(page, new RegExp(code))).toHaveCount(0);

  await page.goto("/trash");
  await main(page).getByRole("listitem").filter({ hasText: title }).getByRole("button", { name: /restore/i }).click();
  await expect(main(page)).not.toContainText(title);

  await page.goto(`/cards?course=${id}`);
  await expect(main(page)).toContainText(`Gone and back ${s}?`);
  await expect(deckLink(page, new RegExp(code))).toContainText("1 due");
});

test("the course page links to its own deck", async ({ page }) => {
  const s = Date.now();
  const code = `CRS${s}`;
  const id = await makeCourse(page, code);
  const note = await makeNote(page, `Course note ${s}`, "Note.", code);
  await addBasic(page, note, `On the course page ${s}?`, "yes");

  await page.goto(`/courses/${id}`);
  await expect(main(page)).toContainText("1 of 1 flashcard due");
  const link = main(page).getByRole("link", { name: "Review this deck" });
  await expect(link).toHaveAttribute("href", `/cards?course=${id}`);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/cards\\?course=${id}$`));
  await expect(main(page)).toContainText(`On the course page ${s}?`);
});

for (const scheme of ["light", "dark"] as const) {
  test(`the deck list fits a phone in ${scheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 375, height: 812 });
    const s = Date.now();
    const code = `PHN${scheme.toUpperCase()}${s}`; // a long code, to make the list work for it
    await makeCourse(page, code);
    const note = await makeNote(page, `Phone deck ${s}`, "Note.", code);
    await addBasic(page, note, `Phone question ${s}?`, "yes");

    await page.goto("/cards");
    const links = await decks(page).getByRole("link").all();
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const link of links) {
      const box = await link.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
