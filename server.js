const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');

console.log('🚀 Démarrage du système restaurant complet...');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Middleware
app.use(express.json());
app.use(express.static(__dirname));
app.use('/tickets', express.static(path.join(__dirname, 'tickets')));

// Gestion des dossiers
const ticketsDir = path.join(__dirname, 'tickets');
if (!fs.existsSync(ticketsDir)) {
    fs.mkdirSync(ticketsDir);
    console.log('📁 Dossier tickets créé');
}

// Menu initial
let menuItems = [
    { 
        id: 1, 
        name: 'Burger Classique', 
        description: 'Steak haché, fromage, salade, tomate', 
        price: 12.99, 
        image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400&h=300&fit=crop', 
        preparationTime: 15, 
        category: 'Plats principaux',
        isActive: true
    },
    { 
        id: 2, 
        name: 'Pizza Margherita', 
        description: 'Sauce tomate, mozzarella, basilic', 
        price: 14.99, 
        image: 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=400&h=300&fit=crop', 
        preparationTime: 20, 
        category: 'Plats principaux',
        isActive: true
    }
];

let orders = [];
let orderId = 1;
let dailySales = {
    date: new Date().toISOString().split('T')[0],
    total: 0,
    ordersCount: 0,
    cashOpen: false,
    openTime: null,
    closeTime: null,
    salesByHour: {}
};

// Fonctions utilitaires pour les métriques
function calculateAveragePrepTime() {
    const prepOrders = orders.filter(o => o.status === 'preparing');
    if (prepOrders.length === 0) return 0;
    
    const totalMinutes = prepOrders.reduce((sum, order) => {
        const elapsed = (new Date() - new Date(order.timestamp)) / 60000;
        return sum + elapsed;
    }, 0);
    
    return Math.round(totalMinutes / prepOrders.length);
}

function getTimeAlerts() {
    const now = new Date();
    return orders.filter(order => {
        const elapsed = (now - new Date(order.timestamp)) / 60000;
        return elapsed > 30;
    }).length;
}

function getMostPopularDish() {
    if (orders.length === 0) return 'Aucune donnée';
    
    const dishCount = {};
    orders.forEach(order => {
        order.items.forEach(item => {
            dishCount[item.name] = (dishCount[item.name] || 0) + item.quantity;
        });
    });
    
    const mostPopular = Object.entries(dishCount).sort((a, b) => b[1] - a[1])[0];
    return mostPopular ? mostPopular[0] : 'Aucune donnée';
}

function calculateOrdersPerHour() {
    const now = new Date();
    const currentHour = now.getHours();
    const ordersThisHour = orders.filter(order => {
        const orderHour = new Date(order.timestamp).getHours();
        return orderHour === currentHour;
    });
    return ordersThisHour.length;
}

// Routes API
app.get('/api/menu', (req, res) => {
    res.json(menuItems.filter(item => item.isActive));
});

app.post('/api/menu', (req, res) => {
    const newItem = {
        id: menuItems.length > 0 ? Math.max(...menuItems.map(i => i.id)) + 1 : 1,
        ...req.body,
        isActive: true
    };
    menuItems.push(newItem);
    io.emit('menuItems', menuItems.filter(item => item.isActive));
    res.json(newItem);
});

app.put('/api/menu/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const index = menuItems.findIndex(item => item.id === id);
    
    if (index !== -1) {
        menuItems[index] = { ...menuItems[index], ...req.body };
        io.emit('menuItems', menuItems.filter(item => item.isActive));
        res.json(menuItems[index]);
    } else {
        res.status(404).json({ error: 'Plat non trouvé' });
    }
});

app.delete('/api/menu/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const index = menuItems.findIndex(item => item.id === id);
    
    if (index !== -1) {
        menuItems[index].isActive = false;
        io.emit('menuItems', menuItems.filter(item => item.isActive));
        res.json({ message: 'Plat désactivé' });
    } else {
        res.status(404).json({ error: 'Plat non trouvé' });
    }
});

// Gestion de la caisse
app.post('/api/cash/open', (req, res) => {
    if (!dailySales.cashOpen) {
        dailySales.cashOpen = true;
        dailySales.openTime = new Date();
        dailySales.salesByHour = {};
        console.log('💰 Caisse ouverte');
        io.emit('cashStatus', dailySales);
        res.json(dailySales);
    } else {
        res.status(400).json({ error: 'Caisse déjà ouverte' });
    }
});

app.post('/api/cash/close', (req, res) => {
    if (dailySales.cashOpen) {
        dailySales.cashOpen = false;
        dailySales.closeTime = new Date();
        console.log('💰 Caisse fermée - Total:', dailySales.total);
        io.emit('cashStatus', dailySales);
        res.json(dailySales);
    } else {
        res.status(400).json({ error: 'Caisse déjà fermée' });
    }
});

app.get('/api/cash/summary', (req, res) => {
    res.json(dailySales);
});

// Gestion des commandes
app.post('/api/orders', (req, res) => {
    const orderData = req.body;
    const hour = new Date().getHours();
    
    const newOrder = {
        id: orderId++,
        items: orderData.items,
        tableNumber: orderData.tableNumber,
        customerName: orderData.customerName,
        status: 'pending',
        timestamp: new Date(),
        total: orderData.total,
        paid: false,
        notes: orderData.notes || ''
    };
    
    orders.push(newOrder);
    
    // Mettre à jour les ventes journalières
    if (dailySales.cashOpen) {
        dailySales.total += orderData.total;
        dailySales.ordersCount++;
        
        // Ventes par heure
        if (!dailySales.salesByHour[hour]) {
            dailySales.salesByHour[hour] = 0;
        }
        dailySales.salesByHour[hour] += orderData.total;
    }
    
    // Diffuser la nouvelle commande
    io.to('kitchen-room').emit('displayOrder', newOrder);
    io.emit('cashStatus', dailySales);
    console.log(`📤 Commande #${newOrder.id} - ${orderData.total}FCFA`);
    
    res.json(newOrder);
});

// Démarrer l'affichage
app.post('/api/display/start', (req, res) => {
    console.log('🚀 Affichage lancé');
    io.emit('startDisplay', { message: 'Affichage activé' });
    res.json({ message: 'Affichage lancé' });
});

// Obtenir les métriques cuisine
app.get('/api/kitchen/metrics', (req, res) => {
    const metrics = {
        totalOrders: orders.length,
        avgPrepTime: calculateAveragePrepTime(),
        ordersPerHour: calculateOrdersPerHour(),
        topDish: getMostPopularDish(),
        alerts: getTimeAlerts(),
        pendingOrders: orders.filter(o => o.status === 'pending').length,
        preparingOrders: orders.filter(o => o.status === 'preparing').length,
        readyOrders: orders.filter(o => o.status === 'ready').length,
        servedOrders: orders.filter(o => o.status === 'served').length
    };
    res.json(metrics);
});

// Ticket de caisse
app.get('/api/ticket/:orderId', (req, res) => {
    const orderId = parseInt(req.params.orderId);
    const order = orders.find(o => o.id === orderId);
    
    if (!order) {
        return res.status(404).json({ error: 'Commande non trouvée' });
    }
    
    const doc = new PDFDocument({ 
        size: [250, 500],
        margin: 15,
        layout: 'portrait'
    });
    
    const filename = `ticket-${orderId}-${Date.now()}.pdf`;
    const filepath = path.join(ticketsDir, filename);
    
    const writeStream = fs.createWriteStream(filepath);
    doc.pipe(writeStream);
    
    // Couleurs
    const black = '#000000';
    const gray = '#555555';
    const red = '#e74c3c';
    const blue = '#3498db';
    
    // En-tête
    doc.font('Helvetica-Bold')
       .fontSize(16)
       .fillColor(black)
       .text('🍽️ SUNU RESTO', 0, 20, { align: 'center', width: doc.page.width });
    
    doc.font('Helvetica')
       .fontSize(9)
       .fillColor(gray)
       .text('Ticket de caisse', 0, 40, { align: 'center', width: doc.page.width });
    
    // Ligne
    doc.moveTo(20, 60)
       .lineTo(doc.page.width - 20, 60)
       .lineWidth(1)
       .stroke();
    
    // Infos commande
    let yPos = 70;
    
    doc.font('Helvetica-Bold')
       .fontSize(12)
       .fillColor(black)
       .text(`COMMANDE #${order.id}`, 0, yPos, { align: 'center', width: doc.page.width });
    
    yPos += 20;
    
    const orderDate = new Date(order.timestamp);
    const dateStr = orderDate.toLocaleDateString('fr-FR');
    const timeStr = orderDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    
    doc.font('Helvetica')
       .fontSize(9)
       .fillColor(black)
       .text(`Table: ${order.tableNumber} • Client: ${order.customerName || 'Non spécifié'}`, 20, yPos, { width: doc.page.width - 40 });
    
    yPos += 12;
    
    doc.font('Helvetica')
       .fontSize(9)
       .fillColor(black)
       .text(`Date: ${dateStr} • Heure: ${timeStr}`, 20, yPos, { width: doc.page.width - 40 });
    
    yPos += 25;
    
    // Ligne
    doc.moveTo(20, yPos)
       .lineTo(doc.page.width - 20, yPos)
       .lineWidth(0.5)
       .stroke(gray);
    
    yPos += 15;
    
    // Articles
    doc.font('Helvetica-Bold')
       .fontSize(10)
       .fillColor(black)
       .text('ARTICLES', 0, yPos, { align: 'center', width: doc.page.width });
    
    yPos += 15;
    
    // En-tête du tableau
    const col1 = 20;    // Article
    const col2 = 160;   // Qté
    const col3 = 180;   // Prix
    const col4 = 210;   // Total
    
    doc.font('Helvetica-Bold')
       .fontSize(8)
       .fillColor(gray)
       .text('Article', col1, yPos);
    
    doc.font('Helvetica-Bold')
       .fontSize(8)
       .fillColor(gray)
       .text('Qté', col2, yPos);
    
    doc.font('Helvetica-Bold')
       .fontSize(8)
       .fillColor(gray)
       .text('Prix', col3, yPos);
    
    doc.font('Helvetica-Bold')
       .fontSize(8)
       .fillColor(gray)
       .text('Total', col4, yPos);
    
    yPos += 12;
    
    // Ligne sous en-tête
    doc.moveTo(20, yPos)
       .lineTo(doc.page.width - 20, yPos)
       .lineWidth(0.3)
       .stroke(gray);
    
    yPos += 10;
    
    // Articles
    order.items.forEach((item) => {
        const itemTotal = item.price * item.quantity;
        
        // Article
        doc.font('Helvetica')
           .fontSize(8)
           .fillColor(black)
           .text(item.name, col1, yPos, { width: 130 });
        
        // Quantité
        doc.font('Helvetica')
           .fontSize(8)
           .fillColor(black)
           .text(item.quantity.toString(), col2, yPos);
        
        // Prix unitaire
        doc.font('Helvetica')
           .fontSize(8)
           .fillColor(black)
           .text(`${item.price.toFixed(0)}`, col3, yPos);
        
        // Total article
        doc.font('Helvetica')
           .fontSize(8)
           .fillColor(black)
           .text(`${itemTotal.toFixed(0)}`, col4, yPos);
        
        yPos += 15;
    });
    
    yPos += 10;
    
    // Total
    doc.moveTo(20, yPos)
       .lineTo(doc.page.width - 20, yPos)
       .lineWidth(1)
       .stroke();
    
    yPos += 15;
    
    doc.font('Helvetica-Bold')
       .fontSize(14)
       .fillColor(black)
       .text('TOTAL', 20, yPos);
    
    const totalText = `${order.total.toFixed(0)} FCFA`;
    const totalWidth = doc.widthOfString(totalText, { fontSize: 14 });
    doc.font('Helvetica-Bold')
       .fontSize(14)
       .fillColor(red)
       .text(totalText, doc.page.width - 20 - totalWidth, yPos);
    
    yPos += 25;
    
    // TVA
    const tvaAmount = (order.total * 0.187).toFixed(0);
    const tvaText = `TVA incluse (18,7%) : ${tvaAmount} FCFA`;
    doc.font('Helvetica')
       .fontSize(8)
       .fillColor(gray)
       .text(tvaText, 0, yPos, { align: 'center', width: doc.page.width });
    
    yPos += 25;
    
    // Pied de page
    doc.moveTo(20, yPos)
       .lineTo(doc.page.width - 20, yPos)
       .lineWidth(1)
       .stroke(blue);
    
    yPos += 15;
    
    doc.font('Helvetica-Bold')
       .fontSize(10)
       .fillColor(blue)
       .text('MERCI DE VOTRE VISITE !', 0, yPos, { align: 'center', width: doc.page.width });
    
    yPos += 12;
    
    doc.font('Helvetica')
       .fontSize(8)
       .fillColor(black)
       .text('À bientôt dans notre restaurant', 0, yPos, { align: 'center', width: doc.page.width });
    
    yPos += 15;
    
    doc.font('Helvetica')
       .fontSize(7)
       .fillColor(gray)
       .text(`Réf: ${orderId.toString().padStart(6, '0')}`, 0, yPos, { align: 'center', width: doc.page.width });
    
    yPos += 10;
    
    doc.font('Helvetica')
       .fontSize(7)
       .fillColor(gray)
       .text('Ticket généré automatiquement', 0, yPos, { align: 'center', width: doc.page.width });
    
    // Fin du document
    doc.end();
    
    writeStream.on('finish', () => {
        res.json({ 
            message: 'Ticket généré avec succès',
            filename: filename,
            url: `/tickets/${filename}`,
            orderId: order.id,
            total: order.total
        });
    });
});

// Routes HTML
app.get('/director', (req, res) => {
    res.sendFile(path.join(__dirname, 'director.html'));
});

app.get('/kitchen', (req, res) => {
    res.sendFile(path.join(__dirname, 'kitchen.html'));
});

app.get('/', (req, res) => {
    res.redirect('/director');
});

// Socket.io
io.on('connection', (socket) => {
    console.log('🟢 Client connecté:', socket.id);
    
    // Envoyer les données initiales
    socket.emit('menuItems', menuItems.filter(item => item.isActive));
    socket.emit('initialOrders', orders);
    socket.emit('cashStatus', dailySales);
    
    // 1. Rejoindre la room cuisine
    socket.on('joinKitchen', () => {
        socket.join('kitchen-room');
        console.log(`🔧 Écran cuisine (${socket.id}) a rejoint la room.`);
        socket.emit('initialOrders', orders);
        
        // Envoyer les métriques initiales
        const metrics = {
            totalOrders: orders.length,
            avgPrepTime: calculateAveragePrepTime(),
            ordersPerHour: calculateOrdersPerHour(),
            topDish: getMostPopularDish(),
            alerts: getTimeAlerts(),
            pendingOrders: orders.filter(o => o.status === 'pending').length,
            preparingOrders: orders.filter(o => o.status === 'preparing').length,
            readyOrders: orders.filter(o => o.status === 'ready').length,
            servedOrders: orders.filter(o => o.status === 'served').length
        };
        socket.emit('kitchenMetrics', metrics);
    });
    
    // 2. Rejoindre la room directeur
    socket.on('joinDirector', () => {
        socket.join('director-room');
        console.log(`🏢 Directeur (${socket.id}) a rejoint la room.`);
    });
    
    // 3. Nouvelle commande
    socket.on('newOrder', (orderData) => {
        console.log('📥 Nouvelle commande (Socket):', orderData);
        
        const orderItems = orderData.items.map(item => {
            const menuItem = menuItems.find(m => m.id === item.id);
            return { ...menuItem, quantity: item.quantity };
        });
        
        const total = orderItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const hour = new Date().getHours();
        
        const newOrder = {
            id: orderId++,
            items: orderItems,
            tableNumber: orderData.tableNumber,
            customerName: orderData.customerName,
            status: 'pending',
            timestamp: new Date(),
            total: total,
            paid: false,
            notes: orderData.notes || ''
        };
        
        orders.push(newOrder);
        
        // Mettre à jour les ventes journalières
        if (dailySales.cashOpen) {
            dailySales.total += total;
            dailySales.ordersCount++;
            
            if (!dailySales.salesByHour[hour]) {
                dailySales.salesByHour[hour] = 0;
            }
            dailySales.salesByHour[hour] += total;
        }
        
        // Envoyer uniquement à la cuisine
        io.to('kitchen-room').emit('displayOrder', newOrder);
        io.emit('cashStatus', dailySales);
        console.log(`📤 Commande #${newOrder.id} envoyée à la cuisine - ${total}FCFA`);
    });
    
    // 4. Mettre à jour le statut de la commande
    socket.on('updateOrderStatus', (data) => {
        const order = orders.find(o => o.id === data.orderId);
        if (order) {
            order.status = data.status;
            if (data.status === 'ready') {
                order.readyTime = new Date();
            } else if (data.status === 'served') {
                order.servedTime = new Date();
            }
            
            // Diffuser la mise à jour
            io.emit('orderStatusUpdated', order);
            
            // Envoyer les métriques mises à jour
            const metrics = {
                totalOrders: orders.length,
                avgPrepTime: calculateAveragePrepTime(),
                ordersPerHour: calculateOrdersPerHour(),
                topDish: getMostPopularDish(),
                alerts: getTimeAlerts(),
                pendingOrders: orders.filter(o => o.status === 'pending').length,
                preparingOrders: orders.filter(o => o.status === 'preparing').length,
                readyOrders: orders.filter(o => o.status === 'ready').length,
                servedOrders: orders.filter(o => o.status === 'served').length
            };
            
            io.to('kitchen-room').emit('kitchenMetrics', metrics);
        }
    });
    
    // 5. Marquer comme servie (depuis la cuisine)
    socket.on('markAsServed', (data) => {
        const orderIndex = orders.findIndex(o => o.id === data.orderId);
        if (orderIndex !== -1) {
            orders[orderIndex].status = 'served';
            orders[orderIndex].servedTimestamp = data.servedTimestamp || new Date();
            
            console.log(`✅ Commande #${data.orderId} marquée comme servie`);
            
            // Diffuser à tous les clients
            io.emit('orderServed', data.orderId);
            io.emit('orderStatusUpdated', orders[orderIndex]);
            
            // Envoyer les métriques mises à jour
            const metrics = {
                totalOrders: orders.length,
                avgPrepTime: calculateAveragePrepTime(),
                ordersPerHour: calculateOrdersPerHour(),
                topDish: getMostPopularDish(),
                alerts: getTimeAlerts(),
                pendingOrders: orders.filter(o => o.status === 'pending').length,
                preparingOrders: orders.filter(o => o.status === 'preparing').length,
                readyOrders: orders.filter(o => o.status === 'ready').length,
                servedOrders: orders.filter(o => o.status === 'served').length
            };
            
            io.to('kitchen-room').emit('kitchenMetrics', metrics);
        }
    });
    
    // 6. Demande de métriques cuisine
    socket.on('getKitchenMetrics', () => {
        const metrics = {
            totalOrders: orders.length,
            avgPrepTime: calculateAveragePrepTime(),
            ordersPerHour: calculateOrdersPerHour(),
            topDish: getMostPopularDish(),
            alerts: getTimeAlerts(),
            pendingOrders: orders.filter(o => o.status === 'pending').length,
            preparingOrders: orders.filter(o => o.status === 'preparing').length,
            readyOrders: orders.filter(o => o.status === 'ready').length,
            servedOrders: orders.filter(o => o.status === 'served').length
        };
        socket.emit('kitchenMetrics', metrics);
    });
    
    // 7. Démarrer l'affichage
    socket.on('startDisplay', () => {
        console.log('🚀 Affichage lancé depuis le bureau');
        io.emit('startDisplay', { message: 'Affichage activé' });
    });
    
    // 8. Déconnexion
    socket.on('disconnect', () => {
        console.log('🔴 Client déconnecté:', socket.id);
    });
});

// Démarrer le serveur
const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log('='.repeat(60));
    console.log('🍽️  SUNU RESTO - Système de Gestion');
    console.log('='.repeat(60));
    console.log(`👉 Bureau Directeur: http://localhost:${PORT}/director`);
    console.log(`👨‍🍳 Écran Cuisine:  http://localhost:${PORT}/kitchen`);
    console.log('='.repeat(60));
    console.log('✅ Prêt à recevoir des commandes');
}).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`❌ ERREUR : Le port ${PORT} est déjà utilisé`);
        console.error('Fermez l\'autre application ou redémarrez l\'ordinateur');
    } else {
        console.error('❌ ERREUR lors du démarrage du serveur:', err.message);
    }
    process.exit(1);
});