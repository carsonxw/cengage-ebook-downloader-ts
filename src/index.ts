import axios from "axios";
import puppeteer_core, { ElementHandle } from "puppeteer-core";
import fs from "fs";
import path from "path";

const loginUrl = "https://account.cengage.com/login";
const executablePath =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const account = "";
const password = "";
const ebookDiv_id = ".css-1q4s59m"; // replace with the outer div id of the ebook you want to download

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const downloadEbook = async () => {
  const browser = await puppeteer_core.launch({
    headless: false,
    defaultViewport: null,
    executablePath,
  });
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(60000);
  page.setDefaultTimeout(60000);
  const getEbookUrlOffResponses = (callback: (ebookUrl: string) => void) => {
    page.on("response", async (response) => {
      const request = response.request();
      if (
        request.url().includes("https://au.cengage.com/services/stx/bff/ebooks")
      ) {
        const responseBodyJson = await response.json();
        const { ebooks } = responseBodyJson;
        if (ebooks?.length) {
          callback(ebooks[0].url);
        }
      }
    });
  };
  try {
    // start logging in
    await page.goto(loginUrl, { waitUntil: "load" });

    await page.waitForFunction('document.readyState === "complete"');
    console.log("Login Page is fully loaded");

    await page.type("#idp-discovery-username", account);
    await page.click("#idp-discovery-submit"),
      await page.waitForSelector("#okta-signin-password");
    await page.type("#okta-signin-password", password);
    await page.click("#okta-signin-submit");

    await page.waitForFunction('document.readyState === "complete"');
    console.log("Dashboard Page is fully loaded");

    await page.waitForSelector(ebookDiv_id);

    await page.reload();

    getEbookUrlOffResponses(async (ebookUrl) => {
      if (ebookUrl) {
        // navigate to ebook page
        const navigationToEbookPromise = page.waitForNavigation({
          waitUntil: "networkidle0",
        });
        await Promise.all([
          page.goto(ebookUrl, { waitUntil: "load" }),
          navigationToEbookPromise,
        ]);

        // start accessing iframe
        setInterval(async () => {
          let nextPageButton: ElementHandle<Element> | undefined;
          let imgSrc: string | undefined;
          while (true) {
            const _iframe_page = await page.$("#iframe-page");

            if (_iframe_page) {
              const frame = await _iframe_page.contentFrame();
              if (frame) {
                const hiddenImageElement = await frame.waitForSelector(
                  "#hiddenImage",
                  { hidden: true }
                );
                if (hiddenImageElement) {
                  const imageSrcHandle = await hiddenImageElement.getProperty(
                    "src"
                  );
                  const _imgSrc = (await imageSrcHandle.jsonValue()) as string;
                  imgSrc = _imgSrc;
                }
              }
            }
            break;
          }
          if (imgSrc) {
            const navigationToPageImgPromise = page.waitForNavigation({
              waitUntil: "networkidle0",
            });

            await Promise.all([
              page.goto(imgSrc, { waitUntil: "load" }),
              navigationToPageImgPromise,
            ]);
            const innerImgSrc = await page.$eval("img", (el) => el.src);
            if (innerImgSrc) {
              const response = await axios.get(innerImgSrc, {
                responseType: "arraybuffer",
              });
              const buffer = Buffer.from(response.data, "binary");
              const filePath = path.resolve(
                __dirname,
                "ebook",
                `image-${Date.now()}.jpg`
              );
              fs.writeFile(filePath, buffer, async (err) => {
                if (err) {
                  throw err;
                }
                console.log(`Image downloaded to ${filePath}`);
              });
              await page.goBack();
              await sleep(10000);
              // click next
              while (true) {
                await page.waitForSelector("#next-page");
                const _nextPageButton = await page.$("#next-page");
                if (_nextPageButton) {
                  nextPageButton = _nextPageButton;
                }
                break;
              }
              if (!!nextPageButton) {
                // @ts-ignore
                await page.evaluate((el) => el.click(), nextPageButton);
              }
            }
          }
        }, 20000);
      }
    });
  } catch (error) {
    console.log(error);
  }
};

downloadEbook();
