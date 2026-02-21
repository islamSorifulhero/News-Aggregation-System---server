const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cron = require("node-cron");
const axios = require("axios");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// ─── CONFIG ────────────────────────────────────────────────────────────────
// const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/newsdb";
const MONGO_URI = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.maurhd8.mongodb.net/newsdb?retryWrites=true&w=majority&appName=Cluster0`;
const NEWS_API_KEY = process.env.NEWS_API_KEY || "YOUR_NEWSDATA_IO_API_KEY";
const PORT = process.env.PORT || 5000;

// ─── MONGOOSE SCHEMA ───────────────────────────────────────────────────────
const articleSchema = new mongoose.Schema(
  {
    article_id: { type: String, unique: true, required: true },
    title: String,
    link: String,
    keywords: [String],
    creator: [String],
    video_url: String,
    description: String,
    content: String,
    pubDate: Date,
    image_url: String,
    source_id: String,
    source_priority: Number,
    source_url: String,
    source_icon: String,
    language: String,
    country: [String],
    category: [String],
    ai_tag: String,
    sentiment: String,
    sentiment_stats: mongoose.Schema.Types.Mixed,
    ai_region: String,
    ai_org: String,
    duplicate: Boolean,
    datatype: String, // news, blog, podcast, etc.
  },
  { timestamps: true }
);

const Article = mongoose.model("Article", articleSchema);

// ─── MONGOOSE CONNECT ──────────────────────────────────────────────────────
mongoose
  .connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB error:", err));

// ─── FETCH & UPSERT ARTICLES ───────────────────────────────────────────────
async function fetchAndStoreNews() {
  console.log(`[${new Date().toISOString()}] 🔄 Fetching news from NewsData.io...`);
  try {
    const response = await axios.get("https://newsdata.io/api/1/news", {
      params: {
        apikey: NEWS_API_KEY,
        language: "en",
        // You can add: country, category, q, etc. here
      },
    });

    const articles = response.data?.results || [];
    if (!articles.length) {
      console.log("⚠️  No articles returned from API");
      return;
    }

    let inserted = 0;
    let updated = 0;

    for (const art of articles) {
      const doc = {
        article_id: art.article_id,
        title: art.title,
        link: art.link,
        keywords: art.keywords || [],
        creator: art.creator || [],
        video_url: art.video_url,
        description: art.description,
        content: art.content,
        pubDate: art.pubDate ? new Date(art.pubDate) : null,
        image_url: art.image_url,
        source_id: art.source_id,
        source_priority: art.source_priority,
        source_url: art.source_url,
        source_icon: art.source_icon,
        language: art.language,
        country: art.country || [],
        category: art.category || [],
        ai_tag: art.ai_tag,
        sentiment: art.sentiment,
        sentiment_stats: art.sentiment_stats,
        ai_region: art.ai_region,
        ai_org: art.ai_org,
        duplicate: art.duplicate,
        datatype: art.datatype || "news",
      };

      const result = await Article.updateOne(
        { article_id: art.article_id },
        { $set: doc },
        { upsert: true }
      );

      if (result.upsertedCount) inserted++;
      else if (result.modifiedCount) updated++;
    }

    console.log(`✅ Done: ${inserted} inserted, ${updated} updated, ${articles.length} total`);
  } catch (err) {
    console.error("❌ Fetch error:", err.response?.data || err.message);
  }
}

// ─── CRON JOB: every 6 hours ───────────────────────────────────────────────
cron.schedule("0 */6 * * *", () => {
  fetchAndStoreNews();
});

// Run once on startup too
fetchAndStoreNews();

// ─── GET /api/news ─────────────────────────────────────────────────────────
app.get("/api/news", async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      author,
      language,
      country,
      category,
      datatype,
      page = 1,
      limit = 20,
      search,
    } = req.query;

    const filter = {};

    // Date range
    if (startDate || endDate) {
      filter.pubDate = {};
      if (startDate) filter.pubDate.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.pubDate.$lte = end;
      }
    }

    // Author / Creator (case-insensitive partial match)
    if (author) {
      filter.creator = { $elemMatch: { $regex: author, $options: "i" } };
    }

    // Language
    if (language) {
      filter.language = language.toLowerCase();
    }

    // Country (can be comma-separated multiple)
    if (country) {
      const countries = country.split(",").map((c) => c.trim().toLowerCase());
      filter.country = { $in: countries };
    }

    // Category (can be comma-separated multiple)
    if (category) {
      const categories = category.split(",").map((c) => c.trim().toLowerCase());
      filter.category = { $all: categories };
    }

    // Datatype
    if (datatype) {
      filter.datatype = datatype.toLowerCase();
    }

    // Full-text search on title/description
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [articles, total] = await Promise.all([
      Article.find(filter)
        .sort({ pubDate: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Article.countDocuments(filter),
    ]);

    res.json({
      success: true,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      articles,
    });
  } catch (err) {
    console.error("❌ /api/news error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/filters – distinct values for dropdowns ─────────────────────
app.get("/api/filters", async (req, res) => {
  try {
    const [languages, countries, categories, datatypes] = await Promise.all([
      Article.distinct("language"),
      Article.distinct("country"),
      Article.distinct("category"),
      Article.distinct("datatype"),
    ]);

    res.json({
      success: true,
      languages: languages.filter(Boolean).sort(),
      countries: countries.flat().filter(Boolean).sort(),
      categories: categories.flat().filter(Boolean).sort(),
      datatypes: datatypes.filter(Boolean).sort(),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/status – cron/db info ───────────────────────────────────────
app.get("/api/status", async (req, res) => {
  const count = await Article.countDocuments();
  const latest = await Article.findOne().sort({ pubDate: -1 }).lean();
  res.json({
    success: true,
    totalArticles: count,
    latestArticle: latest?.pubDate || null,
    dbStatus: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📅 Cron job scheduled: every 6 hours`);
});








// const express = require("express");
// const cors = require("cors");
// const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
// const PDFDocument = require("pdfkit");
// require("dotenv").config();

// const app = express();
// const port = process.env.PORT || 5000;

// app.use(
//   cors({
//     origin: ["http://localhost:5173", "https://animated-cat-0a19c2.netlify.app"],
//     credentials: true,
//   })
// );
// app.use(express.json());

// app.get("/", (req, res) => {
//   res.json({ message: "✅ Community Cleanliness Server is Running..." });
// });

// const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.maurhd8.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// const client = new MongoClient(uri, {
//   serverApi: {
//     version: ServerApiVersion.v1,
//     strict: true,
//     deprecationErrors: true,
//   },
// });

// async function run() {
//   try {
//     console.log("✅ MongoDB connected successfully");

//     const db = client.db("issues-DB");
//     const issuesCollection = db.collection("issues");
//     const contributionsCollection = db.collection("contributions");
//     const usersCollection = db.collection("users");

//     app.get("/api/issues", async (req, res) => {
//       try {
//         const limit = parseInt(req.query.limit) || 0;
//         const cursor = issuesCollection.find().sort({ date: -1 });
//         const issues = limit
//           ? await cursor.limit(limit).toArray()
//           : await cursor.toArray();
//         res.send(issues);
//       } catch (err) {
//         res.status(500).send({ message: "Error fetching issues" });
//       }
//     });

//     app.get("/api/issues/:id", async (req, res) => {
//       try {
//         const id = req.params.id;
//         const result = await issuesCollection.findOne({
//           _id: new ObjectId(id),
//         });
//         if (!result)
//           return res.status(404).send({ message: "Issue not found" });
//         res.send(result);
//       } catch {
//         res.status(500).send({ message: "Error fetching issue" });
//       }
//     });

//     app.post("/api/issues", async (req, res) => {
//       const issue = req.body;
//       issue.date = new Date();
//       issue.status = "ongoing";
//       const result = await issuesCollection.insertOne(issue);
//       res.send(result);
//     });

//     app.put("/api/issues/:id", async (req, res) => {
//       const id = req.params.id;
//       const updateData = req.body;
//       const result = await issuesCollection.updateOne(
//         { _id: new ObjectId(id) },
//         { $set: updateData }
//       );
//       res.send(result);
//     });

//     app.delete("/api/issues/:id", async (req, res) => {
//       const id = req.params.id;
//       const result = await issuesCollection.deleteOne({
//         _id: new ObjectId(id),
//       });
//       res.send(result);
//     });

//     app.post("/api/contributions", async (req, res) => {
//       const contribution = req.body;
//       contribution.date = new Date();
//       const result = await contributionsCollection.insertOne(contribution);
//       res.send(result);
//     });

//     app.get("/api/contributions/:issueId", async (req, res) => {
//       const issueId = req.params.issueId;
//       const result = await contributionsCollection.find({ issueId }).toArray();
//       res.send(result);
//     });

//     app.get("/api/my-contributions/:email", async (req, res) => {
//       try {
//         const email = req.params.email;
//         const contributions = await contributionsCollection
//           .find({ email })
//           .toArray();

//         const result = await Promise.all(
//           contributions.map(async (c) => {
//             let issueTitle = "Unknown Issue";
//             let category = "N/A";
//             let issue = null;

//             try {
//               issue = await issuesCollection.findOne({
//                 _id: new ObjectId(c.issueId),
//               });
//             } catch {
//               issue = await issuesCollection.findOne({ _id: c.issueId });
//             }

//             if (issue) {
//               issueTitle = issue.title || "Unknown Issue";
//               category = issue.category || "N/A";
//             }

//             return {
//               ...c,
//               issueTitle,
//               category,
//             };
//           })
//         );

//         res.send(result);
//       } catch (err) {
//         res.status(500).send({ message: "Error fetching contributions" });
//       }
//     });

//     app.get("/api/download-pdf/:email", async (req, res) => {
//       try {
//         const email = req.params.email;
//         const contributions = await contributionsCollection
//           .find({ email })
//           .toArray();

//         const result = await Promise.all(
//           contributions.map(async (c) => {
//             let issueTitle = "Unknown Issue";
//             let category = "N/A";
//             let issue = null;

//             try {
//               issue = await issuesCollection.findOne({
//                 _id: new ObjectId(c.issueId),
//               });
//             } catch {
//               issue = await issuesCollection.findOne({ _id: c.issueId });
//             }

//             if (issue) {
//               issueTitle = issue.title || "Unknown Issue";
//               category = issue.category || "N/A";
//             }

//             return {
//               ...c,
//               issueTitle,
//               category,
//             };
//           })
//         );

//         const doc = new PDFDocument();
//         res.setHeader("Content-Type", "application/pdf");
//         res.setHeader(
//           "Content-Disposition",
//           "attachment; filename=my_contributions.pdf"
//         );

//         doc.pipe(res);
//         doc.fontSize(20).text("My Contributions Report", { align: "center" });
//         doc.moveDown();

//         result.forEach((item, i) => {
//           doc
//             .fontSize(12)
//             .text(`${i + 1}. Issue: ${item.issueTitle}`)
//             .text(`   Category: ${item.category}`)
//             .text(`   Amount: ৳${item.amount}`)
//             .text(
//               `   Date: ${new Date(item.date).toLocaleDateString("en-GB")}`
//             )
//             .moveDown();
//         });

//         doc.end();
//       } catch (err) {
//         console.error("PDF Error:", err);
//         res.status(500).send({ message: "Error generating PDF" });
//       }
//     });

//     app.get("/api/community-stats", async (req, res) => {
//       try {
//         const totalUsers = await usersCollection.estimatedDocumentCount();
//         const totalIssues = await issuesCollection.estimatedDocumentCount();

//         const resolvedIssues = await issuesCollection.countDocuments({
//           status: "resolved",
//         });
//         const pendingIssues = totalIssues - resolvedIssues;

//         res.send({
//           totalUsers,
//           totalIssues,
//           resolvedIssues,
//           pendingIssues,
//         });
//       } catch (err) {
//         console.error("Stats error:", err);
//         res.status(500).send({ message: "Error fetching community stats" });
//       }
//     });

//     console.log("✅ MongoDB connection verified!");
//   } catch (err) {
//     console.error("❌ MongoDB Error:", err);
//   }
// }
// run().catch(console.dir);

// app.listen(port, () => {
//   console.log(`🚀 Server running on port ${port}`);
// });
