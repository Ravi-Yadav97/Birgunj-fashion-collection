const fs = require("fs");
const db = JSON.parse(fs.readFileSync("./backend/data/db.json"));
const coat = db.products.find(p => p.name === "coat");
coat.extraImages = ["data:image/jpeg;base64,A", "data:image/jpeg;base64,B", "data:image/jpeg;base64,C"];
fs.writeFileSync("./backend/data/db.json", JSON.stringify(db, null, 2));
console.log("Injected extraImages into db.json");
