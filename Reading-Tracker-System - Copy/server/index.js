const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors'); // Standard CORS for local dev
const Razorpay = require('razorpay');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

// Import Models
const User = require('./models/User');
const Book = require('./models/Book');
const Message = require('./models/Message');

const app = express();

// --- 1. MIDDLEWARE (Fixed for Local PC) ---
app.use(express.json());
app.use(cors({ 
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"], // Allow your frontend
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"]
}));

// --- 2. DB CONNECTION (Local) ---
// We connect directly to your laptop's MongoDB
const DB_URI = "mongodb://127.0.0.1:27017/reading-tracker-db"; 

mongoose.connect(DB_URI)
    .then(() => console.log("✅ Local MongoDB Connected"))
    .catch(err => console.error("❌ DB Connection Error:", err));

const JWT_SECRET = process.env.JWT_SECRET || 'mySuperSecretKey123';

// --- 3. ROUTES ---

// Health Check
app.get('/', (req, res) => {
    res.send("StoryVerse Local Server is Running!");
});

// REGISTER
app.post('/register', async (req, res) => {
    try {
        console.log("👉 Register Request:", req.body);
        const { name, email, password } = req.body;
        
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.json({ status: 'error', message: 'User already exists' });

        const hashedPassword = await bcrypt.hash(password, 10);
        await User.create({ name, email, password: hashedPassword });
        
        console.log("✅ User Created:", email);
        res.json({ status: 'ok' });
    } catch (err) {
        console.error("❌ Register Error:", err);
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// LOGIN
app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.json({ status: 'error', message: 'User not found' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (isMatch) {
            const token = jwt.sign({ email: user.email, id: user._id }, JWT_SECRET);
            return res.json({ status: 'ok', token, user: { name: user.name, id: user._id, plan: user.planType, isMember: user.isMember } });
        } else {
            return res.json({ status: 'error', message: 'Invalid Password' });
        }
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// GET LIBRARY
app.get('/library', async (req, res) => {
    try {
        const books = await Book.find();
        res.json({ status: 'ok', books });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// GET SINGLE BOOK
app.get('/get-book/:id', async (req, res) => {
    try {
        const book = await Book.findById(req.params.id);
        res.json({ status: 'ok', book });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// GET USER DETAILS (For Navbar & Settings)
app.get('/get-user/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if(user) res.json({ status: 'ok', user });
        else res.json({ status: 'error', message: "User not found" });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// UPDATE USER
app.put('/update-user/:id', async (req, res) => {
    try {
        const { name, email } = req.body;
        await User.findByIdAndUpdate(req.params.id, { name, email });
        res.json({ status: 'ok' });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// UPDATE BOOK STATUS/RATING
app.put('/update-book/:id', async (req, res) => {
    try {
        const { rating, review } = req.body;
        await Book.findByIdAndUpdate(req.params.id, { rating, review });
        res.json({ status: 'ok' });
    } catch (err) {
        res.status(500).json({ status: 'error' });
    }
});

// GET PURCHASED COLLECTION
app.get('/my-collection/:userId', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId).populate('purchasedBooks');
        res.json({ status: 'ok', books: user ? user.purchasedBooks : [] });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// CONTACT FORM
app.post('/contact', async (req, res) => {
    try {
        await Message.create(req.body);
        res.json({ status: 'ok' });
    } catch (err) {
        res.status(500).json({ status: 'error' });
    }
});

// RAZORPAY PAYMENT (Your Keys Kept Intact)
app.post('/create-order', async (req, res) => {
    try {
        const razorpay = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID || "rzp_test_Ruf0QnWdRTCqcs", 
            key_secret: process.env.RAZORPAY_KEY_SECRET || "n0EjlUB5PjAaW8EGoRYGwvhn"
        });

        const options = {
            amount: req.body.amount,
            currency: "INR",
            receipt: crypto.randomBytes(10).toString("hex"),
        };

        const order = await razorpay.orders.create(options);
        res.json(order);
    } catch (error) {
        console.error("Razorpay Error:", error);
        res.status(500).send("Error creating order");
    }
});

// VERIFY MEMBERSHIP
app.post('/verify-membership', async (req, res) => {
    try {
        const { userId, planType, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
        
        const secret = process.env.RAZORPAY_KEY_SECRET || "n0EjlUB5PjAaW8EGoRYGwvhn";
        const body = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac('sha256', secret)
            .update(body.toString())
            .digest('hex');

        if (expectedSignature === razorpay_signature) {
            await User.findByIdAndUpdate(userId, { isMember: true, planType: planType });
            res.json({ status: 'ok' });
        } else {
            res.json({ status: 'error', message: 'Invalid Signature' });
        }
    } catch (err) {
        res.status(500).json({ status: 'error' });
    }
});

// CLAIM PREMIUM BOOK
app.post('/claim-premium', async (req, res) => {
    try {
        const { userId, bookId } = req.body;
        const user = await User.findById(userId);
        if (user.isMember) {
            if (!user.purchasedBooks.includes(bookId)) {
                user.purchasedBooks.push(bookId);
                await user.save();
            }
            res.json({ status: 'ok' });
        } else {
            res.json({ status: 'error', message: 'Not a member' });
        }
    } catch (err) {
        res.status(500).json({ status: 'error' });
    }
});

// --- 4. START SERVER (Standard Local Way) ---
const PORT = 5000;
app.listen(PORT, () => console.log(`🚀 Server running on Port ${PORT}`));