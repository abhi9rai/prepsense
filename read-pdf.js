const fs = require("fs");
const pdf = require("pdf-parse-new");

function cleanText(text) {
  const lines = text.split("\n");

  const cleanedLines = lines.map((line) => {
    let prev;
    do {
      prev = line;
      line = line.replace(
        /([A-Za-z0-9][A-Za-z0-9\s&,.'()\-\/:]{2,100}?)\1/g,
        "$1"
      );
    } while (line !== prev);
    return line;
  });

  let result = cleanedLines.join("\n");
  result = result.replace(/\b(\d{2,6})\1\b/g, "$1");
  result = result.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n");
  return result.trim();
}

function chunkText(text, wordsPerChunk = 150) {
  const words = text.split(/\s+/);
  const chunks = [];

  for (let i = 0; i < words.length; i += wordsPerChunk) {
    const chunkWords = words.slice(i, i + wordsPerChunk);
    if (chunkWords.length < 10) continue;
    chunks.push(chunkWords.join(" "));
  }

  return chunks;
}

const dataBuffer = fs.readFileSync("test.pdf");

pdf(dataBuffer).then(function (data) {
  console.log("Number of pages:", data.numpages);
  const cleaned = cleanText(data.text);
  const chunks = chunkText(cleaned);

  console.log("Total chunks created:", chunks.length);

  // Save chunks with metadata to a JSON file
  const chunksWithMeta = chunks.map((text, index) => ({
    id: index,
    text: text,
    source: "test.pdf",
  }));

  fs.writeFileSync("chunks.json", JSON.stringify(chunksWithMeta, null, 2));
  console.log("Saved chunks to chunks.json");
});