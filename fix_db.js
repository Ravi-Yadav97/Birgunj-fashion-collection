const fs = require("fs");
const db = JSON.parse(fs.readFileSync("./backend/data/db.json"));
db.products.forEach(p => {
  if (Array.isArray(p.extraImages)) {
    // Remove duplicates and empty strings
    p.extraImages = [...new Set(p.extraImages.filter(Boolean))];
  } else {
    p.extraImages = [];
  }
});
fs.writeFileSync("./backend/data/db.json", JSON.stringify(db, null, 2));
console.log("Database cleaned!");
