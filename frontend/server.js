'use strict';
const express = require('express');
const path    = require('path');
const app     = express();
const PORT    = 8080;

app.use(express.static(path.join(__dirname)));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => console.log(`[Frontend] Serving on http://0.0.0.0:${PORT}`));
