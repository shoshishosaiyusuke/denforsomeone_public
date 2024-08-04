import express from 'express';
import { Client, Environment } from 'square';
import dotenv from 'dotenv';
import axios from 'axios';
import { aesCmac } from 'node-aes-cmac';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

const client = new Client({
    accessToken: process.env.SQUARE_ACCESS_TOKEN,
    environment: process.env.NODE_ENV === 'production' ? Environment.Production : Environment.Sandbox,
});

function generateRandomTag(secret) {
    let key = Buffer.from(secret, 'hex');

    const date = Math.floor(Date.now() / 1000);
    const dateDate = Buffer.allocUnsafe(4);
    dateDate.writeUInt32LE(date);
    const message = Buffer.from(dateDate.slice(1, 4));

    return aesCmac(key, message);
}

let wm2_cmd = async () => {
    try {
        let sesame_id = process.env.SESAME_UUID;
        let sesame_api_key = process.env.SESAME_API_KEY;
        let key_secret_hex = process.env.KEY_SECRET_HEX;
        let cmd = 88;  // (toggle:88,lock:82,unlock:83)
        let history = "Toggled via API";
        let base64_history = Buffer.from(history).toString('base64');

        console.log(`Sesame ID: ${sesame_id}`);
        console.log(`API Key: ${sesame_api_key}`);
        console.log(`Key Secret Hex: ${key_secret_hex}`);
        console.log(`Command: ${cmd}`);
        console.log(`History (Base64): ${base64_history}`);

        let sign = generateRandomTag(key_secret_hex);
        console.log(`Generated Sign: ${sign}`);

        let after_cmd = await axios({
            method: 'post',
            url: `https://app.candyhouse.co/api/sesame2/${sesame_id}/cmd`,
            headers: { 'x-api-key': sesame_api_key },
            data: {
                cmd: cmd,
                history: base64_history,
                sign: sign,
            }
        });

        console.log('Full Response Data:', after_cmd.data);

        if (after_cmd.data.statusCode === 200) {
            console.log("Command executed successfully.");
        } else {
            console.error("Failed to execute command:", after_cmd.data);
        }
    } catch (error) {
        console.error('Error:', error.response ? error.response.data : error.message);
    }
};

console.log(`Square Access Token is ${process.env.SQUARE_ACCESS_TOKEN ? 'set' : 'not set'}.`);

app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
    res.sendFile('index.html', { root: 'public' });
});

app.get('/success', (req, res) => {
    res.sendFile('success.html', { root: 'public' });
});

app.get('/deny', (req, res) => {
    res.sendFile('deny.html', { root: 'public' });
});

app.post('/verify', async (req, res) => {
    let { phoneNumber } = req.body;
    phoneNumber = `+81${phoneNumber.substring(1)}`;

    try {
        const { result: { customers } } = await client.customersApi.searchCustomers({
            query: {
                filter: {
                    phoneNumber: {
                        exact: phoneNumber
                    }
                }
            }
        });

        if (!customers || customers.length === 0) {
            console.log("No customers found.");
            return res.status(404).json({ status: 'deny', message: 'No customers found.' });
        }

        const customerId = customers[0].id;
        console.log("Customer ID: ", customerId);

        const now = new Date();
        console.log("Current time: ", now);

        const oneDayAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000));
        const startAt = oneDayAgo.toISOString();

        const response = await client.bookingsApi.listBookings(undefined,
            undefined,
            customerId,
            undefined,
            undefined,
            startAt
        );

        console.log("listBookings API response: ", response);

        const bookings = response.result.bookings;

        console.log("now as: ", now);

        const isWithinReservationTime = bookings.some(booking => {
            const startTime = new Date(booking.startAt);
            const endTime = new Date(startTime.getTime() + booking.appointmentSegments[0].durationMinutes * 60000);
            console.log("Start time: ", startTime);
            console.log("End time: ", endTime);
            return now >= startTime && now <= endTime;
        });

        if (isWithinReservationTime) {
            wm2_cmd();
            return res.json({ status: 'accept' });
        } else {
            return res.json({ status: 'deny', message: 'Not within reservation time.' });
        }
        
    } catch (error) {
        console.error('Error verifying phone number:', error);
        res.status(500).json({ status: 'deny' });
    }
});


app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
