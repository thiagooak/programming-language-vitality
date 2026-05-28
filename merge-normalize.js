import fs from "fs";
import path from "path";

function loadJsonFile(filePath) {
  try {
    const data = fs.readFileSync(filePath, "utf8");
    return JSON.parse(data);
  } catch (err) {
    console.error(`Skipping invalid JSON file: ${filePath}`);
    console.error(err.message);
    return null;
  }
}

function mergeJsonFromFolder(folderPath, outputFilePath) {
  // Validate input directory
  if (!fs.existsSync(folderPath) || !fs.lstatSync(folderPath).isDirectory()) {
    console.error("Error: The provided folder path is not a directory.");
    return;
  }

  const files = fs.readdirSync(folderPath);

  // Collect only .json files
  const jsonFiles = files.filter((name) => path.extname(name).toLowerCase() === ".json");

  if (jsonFiles.length === 0) {
    console.error("No JSON files found in the folder.");
    return;
  }

  const merged = jsonFiles.reduce((acc, filename) => {
    const fullPath = path.join(folderPath, filename);
    const data = loadJsonFile(fullPath);

    if (data && typeof data === "object" && !Array.isArray(data)) {
      acc.repos = acc.repos.concat(data.repos.map((r) => {
        return {
          id: r.id,
          full_name: r.full_name,
          description: r.description,
          is_fork: r.fork,
          is_archived: r.archived,
          created_at: r.created_at,
          updated_at: r.updated_at,
          pushed_at: r.pushed_at,
          size: r.size,
          stargazers_count: r.stargazers_count,
          language: r.language,
          owner_id: r.owner.id,
          owner_login: r.owner.login,
          owner_type: r.owner.type,
        }
      }))
      return acc;
    }

    console.warn(`File ignored (must contain a JSON object): ${filename}`);
    return acc;
  }, {repos: []});

  try {
    fs.writeFileSync(outputFilePath, JSON.stringify(merged, null, 2), "utf8");
    console.log(`Merged JSON written to: ${outputFilePath}`);
  } catch (err) {
    console.error("Failed to write output file:");
    console.error(err.message);
  }
}

mergeJsonFromFolder("raw/clojure", "data/clojure.json");
mergeJsonFromFolder("raw/elixir",  "data/elixir.json");
mergeJsonFromFolder("raw/zig",     "data/zig.json");
mergeJsonFromFolder("raw/ocaml",   "data/ocaml.json");
