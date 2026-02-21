const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cron = require("node-cron");
const axios = require("axios");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const MONGO_URI = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.maurhd8.mongodb.net/newsdb?retryWrites=true&w=majority&appName=Cluster0`;
const NEWS_API_KEY = process.env.NEWS_API_KEY || "pub_4f0dc8755d3445b7a8ec39f3149f7aa8YOUR_NEWSDATA_IO_API_KEY";
const PORT = process.env.PORT || 5000;

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
    datatype: String,
  },
  { timestamps: true }
);

const Article = mongoose.model("Article", articleSchema);

mongoose
  .connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB error:", err));

async function fetchAndStoreNews() {
  console.log(`[${new Date().toISOString()}] 🔄 Fetching news from NewsData.io...`);
  try {
    const response = await axios.get("https://newsdata.io/api/1/news", {
      params: {
        apikey: NEWS_API_KEY,
        language: "en",
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

cron.schedule("0 */6 * * *", () => {
  fetchAndStoreNews();
});

fetchAndStoreNews();

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

    if (startDate || endDate) {
      filter.pubDate = {};
      if (startDate) filter.pubDate.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.pubDate.$lte = end;
      }
    }

    if (author) {
      filter.creator = { $elemMatch: { $regex: author, $options: "i" } };
    }

    if (language) {
      filter.language = language.toLowerCase();
    }

    if (country) {
      const countries = country.split(",").map((c) => c.trim().toLowerCase());
      filter.country = { $in: countries };
    }

    if (category) {
      const categories = category.split(",").map((c) => c.trim().toLowerCase());
      filter.category = { $all: categories };
    }

    if (datatype) {
      filter.datatype = datatype.toLowerCase();
    }

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