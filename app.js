const express = require("express");
const mongoose = require("mongoose");
require("dotenv").config();
const axios = require("axios");
const cors = require("cors");
const ProductSchema = require("./Models/ProductSchema");
const moment = require("moment");
const MONGO_URI = process.env.MONGO_URI;
const shouldInitialize = process.argv.includes("--initialize-db");

//db connection
const connectDB = () => {
  mongoose
    .connect(MONGO_URI)
    .then(() => console.log("MongoDB Connected"))
    .catch((err) => console.log(err));
};

//initialization of data into DB
const FetchDataAndInsert = () => {
  axios
    .get("https://s3.amazonaws.com/roxiler.com/product_transaction.json")
    .then(async (res) => {
      const data = res.data;
      const productsToInsert = data.map((item) => ({
        id: item.id,
        title: item.title,
        price: item.price,
        description: item.description,
        category: item.category,
        image: item.image,
        sold: item.sold,
        dateOfSale: item.dateOfSale,
      }));
      await ProductSchema.insertMany(productsToInsert);
    })
    .catch((err) => console.log(err));
};

//validate Month
const validateMonth = (req, res, next) => {
  const { month } = req.params;
  if (month >= 1 && month <= 12) {
    next();
  } else {
    return res.send({
      status: 400,
      message: "invalid month",
      error: "month range should be in the range 1-12",
    });
  }
};

const getTransactions = async (month, page, perPage, search) => {
  let transactions;
  if (month) {
    transactions = await ProductSchema.aggregate([
      {
        $sort: { id: 1 },
      },
      {
        $match: {
          $or: [
            { title: { $regex: new RegExp(search, "i") } },
            { description: { $regex: new RegExp(search, "i") } },
            { price: { $regex: new RegExp(search, "i") } },
          ],
        },
      },
    ]);
    transactions = transactions.filter((item) => {
      const dateObj = moment(item.dateOfSale);
      if (dateObj.month() + 1 == month) {
        return item;
      }
    });

    const startIndex = (page - 1) * perPage;
    const endIndex = startIndex + perPage;
    transactions = transactions.slice(startIndex, endIndex);
    return transactions;
  } else {
    transactions = await ProductSchema.aggregate([
      {
        $sort: { id: 1 },
      },
      {
        $match: {
          $or: [
            { title: { $regex: new RegExp(search, "i") } },
            { description: { $regex: new RegExp(search, "i") } },
            { price: { $regex: new RegExp(search, "i") } },
          ],
        },
      },
      {
        $facet: {
          data: [
            { $skip: parseInt((page - 1) * perPage) },
            { $limit: parseInt(perPage) },
          ],
        },
      },
    ]);
    return transactions[0].data;
  }
};

const app = express();

app.use(cors());

// API get transactions
app.get("/transactions/:month?", async (req, res) => {
  try {
    const page = req.query.page || 1;
    const perPage = req.query.perPage || 10;
    const search = req.query.search || "";
    const { month } = req.params;
    const transactions = await getTransactions(month, page, perPage, search);
    return res.send({
      status: 200,
      message: "success",
      data: transactions,
    });
  } catch (err) {
    console.log(err);
    return res.send({
      status: 400,
      message: "fail",
      error: err,
    });
  }
});

//API for statistics
app.get("/statistics/:month", validateMonth, async (req, res) => {
  try {
    const { month } = req.params;
    const AllProducts = await ProductSchema.find();
    let numberOfSoldItems = 0;
    let numberOfUnsoldItems = 0;
    let totalSaleAmount = 0;
    await AllProducts.map((item) => {
      const dateObj = moment(item.dateOfSale);
      if (dateObj.month() + 1 == month) {
        if (item.sold) {
          numberOfSoldItems++;
          totalSaleAmount += item.price;
        } else {
          numberOfUnsoldItems++;
        }
      }
    });
    return res.send({
      status: 200,
      message: "success",
      data: {
        totalSaleAmount: parseFloat(totalSaleAmount.toFixed(2)),
        numberOfSoldItems,
        numberOfUnsoldItems,
      },
    });
  } catch (err) {
    console.log(err);
    return res.send({
      status: 400,
      message: "fail",
      error: err,
    });
  }
});

//API for barChart - price ranges
app.get("/priceRanges/:month", validateMonth, async (req, res) => {
  try {
    const { month } = req.params;
    const allProducts = await ProductSchema.find();
    const priceRanges = {
      "0-100": 0,
      "101-200": 0,
      "201-300": 0,
      "301-400": 0,
      "401-500": 0,
      "501-600": 0,
      "601-700": 0,
      "701-800": 0,
      "801-900": 0,
      "901-above": 0,
    };
    allProducts.forEach((item) => {
      const dateObj = moment(item.dateOfSale);
      if (dateObj.month() + 1 == month) {
        let price = item.price;
        for (const range in priceRanges) {
          const [min, max] = range.split("-").map(Number);
          if (!max && price > min) {
            priceRanges[range]++;
            break;
          } else if (price >= min && price <= max) {
            priceRanges[range]++;
            break;
          }
        }
      }
    });
    return res.send({
      status: 200,
      message: "success",
      data: priceRanges,
    });
  } catch (err) {
    console.log(err);
    return res.send({
      status: 400,
      message: "fail",
      error: err,
    });
  }
});

//API for pie-chart - unique categories
app.get("/categories/:month", validateMonth, async (req, res) => {
  try {
    const { month } = req.params;
    const allProducts = await ProductSchema.find();
    const categories = {};
    allProducts.forEach((item) => {
      const dateObj = moment(item.dateOfSale);
      if (dateObj.month() + 1 == month) {
        let cat = item.category;
        if (!categories[cat]) {
          categories[cat] = 1;
        } else {
          categories[cat]++;
        }
      }
    });
    return res.send({
      status: 200,
      message: "success",
      data: categories,
    });
  } catch (err) {
    return res.send({
      status: 400,
      message: "fail",
      error: err,
    });
  }
});

// complete analysis for month - combining 3 APIs`
app.get("/completeAnalysis/:month", validateMonth, async (req, res) => {
  try {
    const { month } = req.params;
    const [statisticsResponse, priceRangesResponse, categoriesResponse] =
      await Promise.all([
        axios.get(`http://localhost:8001/statistics/${month}`),
        axios.get(`http://localhost:8001/priceRanges/${month}`),
        axios.get(`http://localhost:8001/categories/${month}`),
      ]);

    const statisticsData = statisticsResponse.data.data;
    const priceRangesData = priceRangesResponse.data.data;
    const categoriesData = categoriesResponse.data.data;

    return res.send({
      status: 200,
      message: "success",
      data: {
        totalSaleAmount: statisticsData.totalSaleAmount,
        numberOfSoldItems: statisticsData.numberOfSoldItems,
        numberOfUnsoldItems: statisticsData.numberOfUnsoldItems,
        categories: categoriesData,
        priceRanges: priceRangesData,
      },
    });
  } catch (err) {
    console.log(err);
    return res.send({
      status: 400,
      message: "fail",
      error: err,
    });
  }
});

//server connection
app.listen(8001, async () => {
  try {
    console.log("server is running on port 8001");
    await connectDB();
    if (shouldInitialize) {
      FetchDataAndInsert();
    }
  } catch (err) {
    console.log(err);
  }
});

//run first-time to initialize
// node app.js --initialize-db
