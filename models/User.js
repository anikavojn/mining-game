const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    balance: { type: Number, default: 0.00000000 },
    chips: { type: Number, default: 0 },
    energy: { type: Number, default: 100 },
    maxEnergy: { type: Number, default: 100 },
    basePower: { type: Number, default: 2 },
    voltage: { type: Number, default: 11.8 },
    mining: { type: Boolean, default: false },
    oc: { type: Boolean, default: false },
    shares: { type: Number, default: 0 },
    blocks: { type: Number, default: 0 },
    totalShares: { type: Number, default: 0 },
    totalBlocks: { type: Number, default: 0 },
    totalEarned: { type: Number, default: 0 },
    miningEarned: { type: Number, default: 0 },
    defense: { type: Number, default: 30 },
    equipmentDamage: { type: Number, default: 0 },
    chipsMined: { type: Number, default: 0 },
    inv: { type: Object, default: { cpu_miner: 1 } },
    research: { type: Object, default: {} },
    researchTimers: { type: Object, default: {} },
    researchCompleted: { type: Object, default: {} },
    wiringFaults: { type: Array, default: [false, false, false, false, false, false] },
    dust: { type: Number, default: 0 },
    solar: { type: Number, default: 0 },
    powerBank: { type: Number, default: 0 },
    isBanned: { type: Boolean, default: false },
    lastActive: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);