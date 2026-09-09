require("dotenv").config();
const mongoose = require("mongoose");

const demoCases = [
  { disease: "Influenza", location: "Madison, WI", lat: 43.0731, lng: -89.4012, cases: 18, date: "2026-08-27" },
  { disease: "COVID-19", location: "Chicago, IL", lat: 41.8781, lng: -87.6298, cases: 42, date: "2026-08-30" },
  { disease: "Measles", location: "Milwaukee, WI", lat: 43.0389, lng: -87.9065, cases: 7, date: "2026-09-01" },
  { disease: "Norovirus", location: "Minneapolis, MN", lat: 44.9778, lng: -93.265, cases: 33, date: "2026-09-02" },
  { disease: "Influenza", location: "Detroit, MI", lat: 42.3314, lng: -83.0458, cases: 24, date: "2026-08-24" },
  { disease: "COVID-19", location: "Indianapolis, IN", lat: 39.7684, lng: -86.1581, cases: 19, date: "2026-09-03" },
  { disease: "Malaria", location: "Dakar, Senegal", lat: 14.7167, lng: -17.4677, cases: 57, date: "2026-08-29" },
  { disease: "Cholera", location: "Banjul, The Gambia", lat: 13.4549, lng: -16.579, cases: 12, date: "2026-09-04" },
  { disease: "Dengue", location: "Miami, FL", lat: 25.7617, lng: -80.1918, cases: 28, date: "2026-09-05" },
  { disease: "Influenza", location: "Toronto, Canada", lat: 43.6532, lng: -79.3832, cases: 31, date: "2026-08-31" },
  { disease: "COVID-19", location: "New York, NY", lat: 40.7128, lng: -74.006, cases: 68, date: "2026-09-06" },
  { disease: "Norovirus", location: "Columbus, OH", lat: 39.9612, lng: -82.9988, cases: 16, date: "2026-09-07" },
];

const caseSchema = new mongoose.Schema(
  {
    disease: { type: String, required: true, trim: true },
    location: { type: String, default: "Auto-Captured", trim: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    cases: { type: Number, default: 1, min: 1 },
    date: { type: String, required: true },
  },
  { timestamps: true }
);

const Case = mongoose.model("Case", caseSchema);

async function seedDemoData() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is not configured.");
  }

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });

  const existingDemo = await Case.countDocuments({ location: { $in: demoCases.map((item) => item.location) } });
  if (existingDemo > 0) {
    console.log(`Demo data already appears to exist (${existingDemo} matching records).`);
  } else {
    await Case.insertMany(demoCases);
    console.log(`Inserted ${demoCases.length} demo surveillance records.`);
  }

  await mongoose.disconnect();
}

seedDemoData().catch(async (error) => {
  console.error(error.message);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore disconnect errors during failure cleanup
  }
  process.exit(1);
});
