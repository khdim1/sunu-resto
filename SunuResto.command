#!/usr/bin/env bash

# ========================================
# SUNU RESTO - Lanceur macOS
# ========================================

# Vider les variables d'environnement problématiques
unset DYLD_LIBRARY_PATH
unset LD_LIBRARY_PATH

# Obtenir le chemin absolu du script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo ""
echo "========================================"
echo "   SUNU RESTO - Système de Gestion"
echo "========================================"
echo "📁 Répertoire : $SCRIPT_DIR"
echo ""

# Vérifier si nous sommes en ARM (Apple Silicon)
ARCH=$(uname -m)
if [[ "$ARCH" == "arm64" ]]; then
    echo "🍎 Architecture Apple Silicon détectée"
    export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"
fi

# Vérifier Node.js
if ! command -v node &> /dev/null; then
    echo "❌ ERREUR : Node.js n'est pas installé !"
    echo ""
    echo "Pour installer Node.js :"
    echo "1. Via Homebrew : brew install node"
    echo "2. Via le site officiel : https://nodejs.org"
    echo ""
    
    # Demander si on veut installer via Homebrew
    read -p "Voulez-vous installer Node.js avec Homebrew ? (o/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Oo]$ ]]; then
        if ! command -v brew &> /dev/null; then
            echo "📦 Installation de Homebrew..."
            /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
            
            if [[ "$ARCH" == "arm64" ]]; then
                echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
                eval "$(/opt/homebrew/bin/brew shellenv)"
            fi
        fi
        
        echo "📦 Installation de Node.js..."
        brew install node
    else
        echo "❌ L'installation ne peut pas continuer sans Node.js"
        echo "Appuyez sur Entrée pour quitter..."
        read
        exit 1
    fi
fi

# Vérifier la version de Node.js
NODE_VERSION=$(node --version)
echo "✅ Node.js $NODE_VERSION détecté"

# Vérifier npm
if ! command -v npm &> /dev/null; then
    echo "❌ ERREUR : npm n'est pas installé !"
    exit 1
fi

# Vérifier si les dépendances sont installées
if [ ! -d "node_modules" ]; then
    echo "📦 Installation des dépendances..."
    npm install
    
    if [ $? -ne 0 ]; then
        echo "❌ Erreur lors de l'installation des dépendances"
        echo "Appuyez sur Entrée pour quitter..."
        read
        exit 1
    fi
fi

# Vérifier si le port 3000 est utilisé
if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo "⚠️  Le port 3000 est déjà utilisé !"
    echo "Tentative de libération du port..."
    
    PID=$(lsof -ti:3000)
    if [ ! -z "$PID" ]; then
        echo "Arrêt du processus $PID..."
        kill -9 $PID 2>/dev/null
        sleep 2
    fi
    
    # Vérifier à nouveau
    if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
        echo "❌ Impossible de libérer le port 3000"
        echo "Fermez manuellement l'application utilisant ce port."
        echo "Appuyez sur Entrée pour quitter..."
        read
        exit 1
    fi
fi

# Fonction pour nettoyer à la sortie
cleanup() {
    echo ""
    echo "🛑 Arrêt du serveur..."
    if [ ! -z "$SERVER_PID" ]; then
        kill $SERVER_PID 2>/dev/null
    fi
    echo "✅ Serveur arrêté"
    echo "Appuyez sur Entrée pour fermer cette fenêtre..."
    read
}

# Capturer Ctrl+C et autres signaux
trap cleanup EXIT INT TERM

# Démarrer le serveur en arrière-plan
echo ""
echo "🚀 Démarrage du serveur..."
echo "========================================"
echo "🍽️  SUNU RESTO - Système de Gestion"
echo "========================================"
echo "👉 Bureau Directeur: http://localhost:3000/director"
echo "👨‍🍳 Écran Cuisine:  http://localhost:3000/kitchen"
echo "========================================"
echo "✅ Prêt à recevoir des commandes"
echo "========================================"
echo ""

# Démarrer le serveur et capturer son PID
node server.js &
SERVER_PID=$!

# Attendre que le serveur démarre
echo "⏳ Démarrage du serveur (PID: $SERVER_PID)..."
sleep 3

# Vérifier si le serveur est en cours d'exécution
if ! ps -p $SERVER_PID > /dev/null; then
    echo "❌ Le serveur n'a pas pu démarrer"
    exit 1
fi

# Ouvrir les deux interfaces automatiquement
echo "🌐 Ouverture des interfaces..."
echo "   • Bureau Directeur: http://localhost:3000/director"
echo "   • Écran Cuisine: http://localhost:3000/kitchen"
echo ""

# Ouvrir d'abord le bureau directeur
open "http://localhost:3000/director"

# Attendre 1 seconde puis ouvrir l'écran cuisine
sleep 1
open "http://localhost:3000/kitchen"

echo ""
echo "📋 Commandes disponibles :"
echo "   • 'r' - Redémarrer le serveur"
echo "   • 'o' - Ouvrir le bureau directeur"
echo "   • 'k' - Ouvrir l'écran cuisine"
echo "   • 'b' - Ouvrir LES DEUX interfaces"
echo "   • 'q' - Quitter"
echo ""

# Boucle interactive
while true; do
    read -p "> " -n 1 -r
    echo ""
    
    case $REPLY in
        [Rr]* )
            echo "🔄 Redémarrage du serveur..."
            kill $SERVER_PID 2>/dev/null
            sleep 2
            node server.js &
            SERVER_PID=$!
            echo "✅ Serveur redémarré (PID: $SERVER_PID)"
            ;;
        [Oo]* )
            echo "🌐 Ouverture du bureau directeur..."
            open "http://localhost:3000/director"
            ;;
        [Kk]* )
            echo "👨‍🍳 Ouverture de l'écran cuisine..."
            open "http://localhost:3000/kitchen"
            ;;
        [Bb]* )
            echo "🌐 Ouverture des DEUX interfaces..."
            open "http://localhost:3000/director"
            sleep 0.5
            open "http://localhost:3000/kitchen"
            ;;
        [Qq]* )
            echo "👋 Au revoir !"
            cleanup
            exit 0
            ;;
        * )
            echo "Commande non reconnue. Utilisez r, o, k, b ou q."
            ;;
    esac
done