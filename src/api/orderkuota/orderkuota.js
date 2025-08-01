const axios = require('axios');
const fs = require('fs');
const crypto = require("crypto");
const FormData = require('form-data');
const QRCode = require('qrcode');
const bodyParser = require('body-parser');
const { ImageUploadService } = require('node-upload-images')

function convertCRC16(str) {
    let crc = 0xFFFF;
    const strlen = str.length;

    for (let c = 0; c < strlen; c++) {
        crc ^= str.charCodeAt(c) << 8;

        for (let i = 0; i < 8; i++) {
            if (crc & 0x8000) {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc = crc << 1;
            }
        }
    }

    let hex = crc & 0xFFFF;
    hex = ("000" + hex.toString(16).toUpperCase()).slice(-4);

    return hex;
}

function generateTransactionId() {
    return crypto.randomBytes(5).toString('hex').toUpperCase()
}

function generateExpirationTime() {
    const expirationTime = new Date();
    expirationTime.setMinutes(expirationTime.getMinutes() + 30);
    return expirationTime;
}

async function elxyzFile(buffer) {
    return new Promise(async (resolve, reject) => {
        try {
const service = new ImageUploadService('pixhost.to');
let { directLink } = await service.uploadFromBinary(buffer, 'skyzo.png');
            resolve(directLink);
        } catch (error) {
            console.error('🚫 Upload Failed:', error);
            reject(error);
        }
    });
}

async function generateQRIS(amount) {
    try {
        let qrisData = "code qris lu";

        qrisData = qrisData.slice(0, -4);
        const step1 = qrisData.replace("010211", "010212");
        const step2 = step1.split("5802ID");

        amount = amount.toString();
        let uang = "54" + ("0" + amount.length).slice(-2) + amount;
        uang += "5802ID";

        const result = step2[0] + uang + step2[1] + convertCRC16(step2[0] + uang + step2[1]);

        const buffer = await QRCode.toBuffer(result);

        const uploadedFile = await elxyzFile(buffer);

        return {
            transactionId: generateTransactionId(),
            amount: amount,
            expirationTime: generateExpirationTime(),
            qrImageUrl: uploadedFile
        };
    } catch (error) {
        console.error('Error generating and uploading QR code:', error);
        throw error;
    }
}

async function createQRIS(amount, codeqr) {
    try {
        let qrisData = codeqr;

        qrisData = qrisData.slice(0, -4);
        const step1 = qrisData.replace("010211", "010212");
        const step2 = step1.split("5802ID");

        amount = amount.toString();
        let uang = "54" + ("0" + amount.length).slice(-2) + amount;
        uang += "5802ID";

        const result = step2[0] + uang + step2[1] + convertCRC16(step2[0] + uang + step2[1]);

        const buffer = await QRCode.toBuffer(result);

        const uploadedFile = await elxyzFile(buffer);

        return {
            idtransaksi: generateTransactionId(),
            jumlah: amount,
            expired: generateExpirationTime(),
            imageqris: { 
            url: uploadedFile
            }
        };
    } catch (error) {
        console.error('Error generating and uploading QR code:', error);
        throw error;
    }
}

async function checkQRISStatus(merchant, apiKey) {
    try {
        const apiUrl = `https://qiospay.id/api/mutasi/qris/${merchant}/${apiKey}`;
        const response = await axios.get(apiUrl);
        const result = response.data;
        const data = result.data;

        let capt = '*Q R I S - M U T A S I*\n\n';
        if (!data || data.length === 0) {
            capt += 'Tidak ada data mutasi.';
        } else {
            data.forEach(entry => {
                capt += '```Tanggal:``` ' + `${entry.date}\n`;
                capt += '```Issuer:``` ' + `${entry.brand_name}\n`;
                capt += '```Nominal:``` Rp ${entry.amount}\n\n`;
            });
        }
        return capt;
    } catch (error) {
        console.error('Error checking QRIS status:', error);
        throw error;
    }
}

module.exports = function(app) {
app.get('/orderkuota/createpayment', async (req, res) => {
    const { apikey, amount, codeqr} = req.query;
    const check = global.apikey
    if (!global.apikey.includes(apikey)) return res.json("Apikey tidak valid.")
    try {
        const qrData = await createQRIS(amount, codeqr);
        res.status(200).json({
                status: true,
                result: qrData
        });      
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
    
app.get('/orderkuota/cekstatus', async (req, res) => {
    const { merchant, keyorkut, apikey } = req.query;

    if (!apikey || !merchant || !keyorkut) {
        return res.status(400).json({ status: false, message: 'Parameter tidak lengkap.' });
    }

    if (!global.apikey.includes(apikey)) {
        return res.status(401).json({ status: false, message: 'Apikey tidak valid.' });
    }

    try {
        const apiUrl = `https://qiospay.id/api/mutasi/qris/${merchant}/${keyorkut}`;
        const response = await axios.get(apiUrl);
        const result = response.data;

        if (!result || !Array.isArray(result.data)) {
            return res.status(500).json({ status: false, message: "Invalid response from upstream server." });
        }

        const latestTransaction = result.data.length > 0 ? result.data[0] : null;

        if (latestTransaction) {
            res.status(200).json({
                status: true,
                result: latestTransaction
            });
        } else {
            res.json({ status: false, message: "No transactions found." });
        }
    } catch (error) {
        console.error('❌ Error cekstatus:', error.response?.data || error.message);
        res.status(500).json({
            status: false,
            message: 'Gagal mengambil status transaksi.',
            error: error.response?.data || error.message
        });
    }
});

app.get('/orderkuota/ceksaldo', async (req, res) => {
    const { merchant, keyorkut, apikey } = req.query;
    const check = global.apikey
    if (!global.apikey.includes(apikey)) return res.json("Apikey tidak valid.")
        try {
        const apiUrl = `https://gateway.okeconnect.com/api/mutasi/qris/${merchant}/${keyorkut}`;
        const response = await axios.get(apiUrl);
        const result = await response.data;
                // Check if data exists and get the latest transaction
        const latestTransaction = result.data && result.data.length > 0 ? result.data[0] : null;
                if (latestTransaction) {
         res.status(200).json({
            status: true, 
            result: {
            saldo_qris: latestTransaction.balance
            }
        })
        } else {
            res.json({ message: "No transactions found." });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
})

}
