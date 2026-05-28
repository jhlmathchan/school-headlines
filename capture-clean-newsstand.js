const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");
const { chromium } = require("playwright");

const root = __dirname;
const rawDir = path.join(root, "newsstand-captures", "clean-raw");
const finalDir = path.join(root, "newsstand-captures", "clean");
const htmlPath = path.join(root, "newspaper.html");

const papers = [
  { code: "023", name: "chosun" },
  { code: "020", name: "donga" },
  { code: "028", name: "hani" },
  { code: "032", name: "khan" },
];

function koreanDateTitle(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return `${formatter.format(date)} 헤드라인 모음`;
}

async function updateHtmlTitle() {
  const title = koreanDateTitle();
  const html = await fs.readFile(htmlPath, "utf8");

  const updated = html
    .replace(/<title>.*?헤드라인 모음<\/title>/, `<title>${title}</title>`)
    .replace(/<h1>.*?헤드라인 모음<\/h1>/, `<h1>${title}</h1>`);

  await fs.writeFile(htmlPath, updated);
}

async function capturePaper(page, paper) {
  const url = `https://newsstand.naver.com/?list=&pcode=${paper.code}`;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      console.log(`Capturing ${paper.name}, attempt ${attempt}`);

      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });

      await page.waitForTimeout(9000);

      const rawPath = path.join(rawDir, `${paper.name}.png`);
      await page.screenshot({ path: rawPath, fullPage: false });

      await sharp(rawPath)
        .extract({
          left: 1010,
          top: 435,
          width: 1800,
          height: 1080,
        })
        .resize({ width: 1440 })
        .png()
        .toFile(path.join(finalDir, `${paper.name}.png`));

      return;
    } catch (error) {
      console.log(`${paper.name} failed on attempt ${attempt}: ${error.message}`);

      if (attempt === 3) {
        throw error;
      }

      await page.waitForTimeout(5000);
    }
  }
}

async function main() {
  await fs.mkdir(rawDir, { recursive: true });
  await fs.mkdir(finalDir, { recursive: true });
  await updateHtmlTitle();

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
  });

  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
  });

  for (const paper of papers) {
    await capturePaper(page, paper);
  }

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
