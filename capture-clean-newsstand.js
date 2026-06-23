const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");
const { chromium } = require("playwright");

const root = __dirname;
const rawDir = path.join(root, "newsstand-captures", "clean-raw");
const finalDir = path.join(root, "newsstand-captures", "clean");
const htmlPath = path.join(root, "index.html");

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

async function updateHtmlTimes(times) {
  let html = await fs.readFile(htmlPath, "utf8");
  for (const [name, modified] of Object.entries(times)) {
    const label = modified ? `${modified.split(" ").pop()} 편집` : "";
    html = html.replace(
      new RegExp(`(<span class="ptime" data-p="${name}">)[^<]*(</span>)`),
      `$1${label}$2`
    );
  }
  await fs.writeFile(htmlPath, html);
}

const KW_STOP = new Set(
  ("기자 사진 영상 종합 속보 단독 오늘 내일 어제 올해 작년 지난 지난해 다시 대한 관련 위해 위한 통해 " +
   "이번 최대 최고 최다 역대 우리 모두 그것 이것 사람 경우 정도 가능 추진 발표 공개 확대 강화 결정 " +
   "논란 의혹 주장 대표 사이트 바로 가기 뉴스 기사 입력 다시보기 비결 누구 이유 진짜 결국 그냥 정말").split(/\s+/)
);
const KW_JOSA = /(으로서|으로써|에서는|에게서|이라고|으로|에서|에게|께서|보다|부터|까지|마다|조차|처럼|만큼|이라|라며|라고|이나|에는|에도|은|는|이|가|을|를|의|에|도|와|과|랑|나|만|및)$/;

function extractKeywords(headlines, topN) {
  const counts = {};
  for (const headline of headlines) {
    for (let token of headline.split(/[^가-힣A-Za-z0-9]+/)) {
      if (!token) continue;
      token = token.replace(KW_JOSA, "");
      if (token.length < 2) continue;
      if (!/[가-힣]/.test(token)) continue;
      if (/다$/.test(token)) continue; // 서술어(없다·했다·한다 등) 제외
      if (KW_STOP.has(token)) continue;
      counts[token] = (counts[token] || 0) + 1;
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map((entry) => entry[0]);
}

async function updateHtmlKeywords(headlines) {
  const keywords = extractKeywords(headlines, 6);
  if (!keywords.length) return;
  const html = await fs.readFile(htmlPath, "utf8");
  const updated = html.replace(
    /(<span class="kwlist">)[^<]*(<\/span>)/,
    `$1${keywords.join(" · ")}$2`
  );
  await fs.writeFile(htmlPath, updated);
}

async function capturePaper(page, paper) {
  const url = `https://newsstand.naver.com/?list=&pcode=${paper.code}`;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      console.log(`Capturing ${paper.name}, attempt ${attempt}`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(9000);

      const rawPath = path.join(rawDir, `${paper.name}.png`);
      await page.screenshot({ path: rawPath, fullPage: false });

      await sharp(rawPath)
        .extract({ left: 1010, top: 435, width: 1800, height: 1080 })
        .resize({ width: 960 })
        .extract({ left: 0, top: 124, width: 960, height: 420 })
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toFile(path.join(finalDir, `${paper.name}.png`));

      const content = await page.content();
      const matched = content.match(
        new RegExp(`"id":"${paper.code}"[^}]*?"modified":"([^"]+)"`)
      );

      let headlines = [];
      const frame = page
        .frames()
        .find((f) => f.url().includes(`/include/page/${paper.code}.html`));
      if (frame) {
        try {
          headlines = await frame.evaluate(() => {
            const list = [];
            document.querySelectorAll("a, img[alt]").forEach((el) => {
              const text = (el.textContent || el.getAttribute("alt") || "").trim();
              if (text.length > 4) list.push(text);
            });
            return list;
          });
        } catch (error) {
          /* headline 추출 실패는 무시 */
        }
      }
      return { modified: matched ? matched[1] : "", headlines };
    } catch (error) {
      console.log(`${paper.name} failed on attempt ${attempt}: ${error.message}`);
      if (attempt === 3) throw error;
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

  const times = {};
  const allHeadlines = [];
  for (const paper of papers) {
    const result = await capturePaper(page, paper);
    times[paper.name] = result.modified;
    allHeadlines.push(...result.headlines);
  }

  await browser.close();
  await updateHtmlTimes(times);
  await updateHtmlKeywords(allHeadlines);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
