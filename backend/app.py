import os
import hashlib
import sqlite3
import json
import logging
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = Flask(__name__)
CORS(app)  # Enable Cross-Origin Resource Sharing for Web3 frontend

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("rental_escrow_backend_ps42")

DB_FILE = os.path.join(os.path.dirname(__file__), "rentals.db")
ABI_FILE = os.path.join(os.path.dirname(__file__), "abi.json")

def init_db():
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS properties (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            landlord TEXT NOT NULL,
            tenant TEXT NOT NULL,
            rent_eth REAL NOT NULL,
            deposit_eth REAL NOT NULL,
            duration_months INTEGER NOT NULL,
            rent_wei TEXT NOT NULL,
            deposit_wei TEXT NOT NULL,
            terms_text TEXT NOT NULL,
            sha256_hash TEXT NOT NULL,
            bytes32_hash TEXT NOT NULL,
            status TEXT DEFAULT 'Created',
            total_rent_paid_eth REAL DEFAULT 0.0,
            late_penalties_eth REAL DEFAULT 0.0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS arbitrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            property_id INTEGER NOT NULL,
            inspection_notes TEXT,
            tenant_statement TEXT,
            landlord_statement TEXT,
            recommended_deduction_eth REAL,
            refund_percentage INTEGER,
            ai_reasoning TEXT,
            ai_engine TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (property_id) REFERENCES properties (id)
        )
    """)
    conn.commit()
    conn.close()

init_db()

def get_db_connection():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def compute_sha256_hashes(text: str):
    """Calculates SHA-256 hex string and bytes32 formatted hash."""
    clean_text = text.strip()
    raw_hash = hashlib.sha256(clean_text.encode('utf-8')).hexdigest()
    bytes32_hash = "0x" + raw_hash
    return raw_hash, bytes32_hash

# -----------------------------------------------------------------------------
# API ROUTES (PS 42 REQUIREMENTS)
# -----------------------------------------------------------------------------

@app.route("/", methods=["GET"])
def home():
    """Root endpoint providing service status and available endpoints."""
    return jsonify({
        "ok": True,
        "service": "PS42 Property Rental Escrow Flask Backend",
        "status": "running",
        "endpoints": {
            "health": "/health",
            "abi": "/api/abi",
            "properties": "/api/properties",
            "list_property": "/api/list-property (POST)",
            "arbitrate": "/api/ai-arbitrate (POST)"
        }
    }), 200

@app.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint for hackathon verification."""
    return jsonify({
        "ok": True,
        "service": "PS42 Property Rental Escrow Flask Backend",
        "status": "running"
    }), 200

@app.route("/api/abi", methods=["GET"])
def get_abi():
    """Returns smart contract ABI."""
    if os.path.exists(ABI_FILE):
        with open(ABI_FILE, "r") as f:
            abi = json.load(f)
        return jsonify({"ok": True, "abi": abi})
    return jsonify({"ok": False, "error": "ABI file not found"}), 444

@app.route("/api/list-property", methods=["POST"])
def list_property():
    """
    Receives property & lease terms, calculates SHA-256 hash, saves full record off-chain in SQLite.
    Payload:
    {
        "landlord": "0x...",
        "tenant": "0x...",
        "rent_eth": 0.2,
        "deposit_eth": 0.4,
        "duration_months": 12,
        "terms_text": "Rental agreement terms..."
    }
    """
    try:
        data = request.get_json() or {}
        landlord = data.get("landlord", "").strip().lower()
        tenant = data.get("tenant", "").strip().lower()
        rent_eth = float(data.get("rent_eth", 0.0))
        deposit_eth = float(data.get("deposit_eth", 0.0))
        duration_months = int(data.get("duration_months", 12))
        terms_text = data.get("terms_text", "").strip()

        if not landlord or not tenant:
            return jsonify({"ok": False, "error": "Landlord and Tenant wallet addresses are required"}), 400
        if rent_eth <= 0 or deposit_eth <= 0:
            return jsonify({"ok": False, "error": "Rent and Deposit must be greater than 0 ETH"}), 400
        if not terms_text:
            return jsonify({"ok": False, "error": "Lease terms text is required"}), 400

        # Calculate SHA-256 hash & Wei values
        sha256_hash, bytes32_hash = compute_sha256_hashes(terms_text)
        rent_wei = str(int(rent_eth * 10**18))
        deposit_wei = str(int(deposit_eth * 10**18))
        total_initial_wei = str(int((rent_eth + deposit_eth) * 10**18))

        # Store in SQLite database
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO properties (landlord, tenant, rent_eth, deposit_eth, duration_months, rent_wei, deposit_wei, terms_text, sha256_hash, bytes32_hash, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Created')
            """,
            (landlord, tenant, rent_eth, deposit_eth, duration_months, rent_wei, deposit_wei, terms_text, sha256_hash, bytes32_hash)
        )
        property_id = cursor.lastrowid
        conn.commit()
        conn.close()

        logger.info(f"Listed Property #{property_id} with SHA-256 fingerprint: {bytes32_hash}")

        return jsonify({
            "ok": True,
            "property_id": property_id,
            "landlord": landlord,
            "tenant": tenant,
            "rent_eth": rent_eth,
            "deposit_eth": deposit_eth,
            "duration_months": duration_months,
            "rent_wei": rent_wei,
            "deposit_wei": deposit_wei,
            "total_initial_wei": total_initial_wei,
            "terms_text": terms_text,
            "sha256_hash": sha256_hash,
            "bytes32_hash": bytes32_hash,
            "status": "Created"
        }), 201

    except Exception as e:
        logger.error(f"Error in list_property: {str(e)}")
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route("/api/properties", methods=["GET"])
def list_properties():
    """Returns all properties stored in SQLite off-chain database."""
    conn = get_db_connection()
    properties = conn.execute("SELECT * FROM properties ORDER BY id DESC").fetchall()
    conn.close()
    return jsonify({"ok": True, "properties": [dict(p) for p in properties]})

@app.route("/api/property/<int:property_id>", methods=["GET"])
def get_property(property_id):
    """Fetches details for a single property by ID."""
    conn = get_db_connection()
    prop = conn.execute("SELECT * FROM properties WHERE id = ?", (property_id,)).fetchone()
    conn.close()

    if not prop:
        return jsonify({"ok": False, "error": "Property not found"}), 404

    return jsonify({"ok": True, "property": dict(prop)})

@app.route("/api/ai-arbitrate", methods=["POST"])
def ai_arbitrate_dispute():
    """
    Evaluates deposit deduction disputes between landlord and tenant.
    Outputs recommended deduction amount in ETH, refund percentage, and reasoning.
    Payload:
    {
        "property_id": 1,
        "inspection_notes": "Deep wall scratch in living room, broken sink handle.",
        "tenant_statement": "Sink handle was already loose when moved in.",
        "landlord_statement": "Need $150 / 0.05 ETH deduction for repairs."
    }
    """
    try:
        data = request.get_json() or {}
        property_id = data.get("property_id", 1)
        inspection_notes = data.get("inspection_notes", "").strip()
        tenant_statement = data.get("tenant_statement", "").strip()
        landlord_statement = data.get("landlord_statement", "").strip()

        conn = get_db_connection()
        prop = conn.execute("SELECT * FROM properties WHERE id = ?", (property_id,)).fetchone()
        conn.close()

        deposit_eth = prop["deposit_eth"] if prop else 0.4

        combined_context = f"""
        Property ID: #{property_id}
        Security Deposit Amount: {deposit_eth} ETH
        Inspection Notes: {inspection_notes}
        Tenant Statement: {tenant_statement}
        Landlord Statement: {landlord_statement}
        """

        gemini_api_key = os.getenv("GEMINI_API_KEY")
        recommended_deduction_eth = 0.0
        refund_percentage = 100
        ai_reasoning = ""
        ai_engine = "Heuristic Arbitrator AI Engine"

        # Attempt Gemini API call if key configured
        if gemini_api_key and gemini_api_key != "your_gemini_api_key_here":
            try:
                import google.generativeai as genai
                genai.configure(api_key=gemini_api_key)
                model = genai.GenerativeModel("gemini-1.5-flash")
                prompt = f"""
                You are an impartial, legal smart contract escrow arbitrator settling a tenancy deposit deduction dispute.
                Review the case:
                {combined_context}

                Respond strictly in valid JSON format with keys:
                "recommended_deduction_eth": float (between 0.0 and {deposit_eth}),
                "refund_percentage": integer (between 0 and 100),
                "ai_reasoning": string explanation based on landlord-tenant law and evidence presented.
                """
                response = model.generate_content(prompt)
                res_text = response.text.strip()
                if "```json" in res_text:
                    res_text = res_text.split("```json")[1].split("```")[0].strip()
                elif "```" in res_text:
                    res_text = res_text.split("```")[1].split("```")[0].strip()
                
                parsed = json.loads(res_text)
                recommended_deduction_eth = float(parsed.get("recommended_deduction_eth", 0.0))
                refund_percentage = int(parsed.get("refund_percentage", 100))
                ai_reasoning = parsed.get("ai_reasoning", "")
                ai_engine = "Google Gemini 1.5 Flash AI Arbitrator"
            except Exception as ai_err:
                logger.warning(f"Gemini API failed, using rule engine fallback: {ai_err}")

        # Intelligent Fallback Evaluator
        if not ai_reasoning:
            notes_lower = (inspection_notes + " " + tenant_statement + " " + landlord_statement).lower()
            if "severe" in notes_lower or "broken" in notes_lower or "structural" in notes_lower:
                refund_percentage = 25
                recommended_deduction_eth = round(deposit_eth * 0.75, 4)
                ai_reasoning = "Documented physical damage beyond wear and tear warrants 75% deposit deduction for repairs."
            elif "scratch" in notes_lower or "dirty" in notes_lower or "cleaning" in notes_lower:
                refund_percentage = 80
                recommended_deduction_eth = round(deposit_eth * 0.20, 4)
                ai_reasoning = "Minor cosmetic or cleaning issues identified. Recommend 20% deduction for deep cleaning."
            else:
                refund_percentage = 100
                recommended_deduction_eth = 0.0
                ai_reasoning = "No physical property damage reported. Normal wear and tear is not grounds for withholding security deposit."

        # Save arbitration record in SQLite
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO arbitrations (property_id, inspection_notes, tenant_statement, landlord_statement, recommended_deduction_eth, refund_percentage, ai_reasoning, ai_engine)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (property_id, inspection_notes, tenant_statement, landlord_statement, recommended_deduction_eth, refund_percentage, ai_reasoning, ai_engine)
        )
        conn.commit()
        conn.close()

        return jsonify({
            "ok": True,
            "property_id": property_id,
            "deposit_eth": deposit_eth,
            "recommended_deduction_eth": recommended_deduction_eth,
            "deduction_wei": str(int(recommended_deduction_eth * 10**18)),
            "refund_percentage": refund_percentage,
            "ai_reasoning": ai_reasoning,
            "ai_engine": ai_engine
        })

    except Exception as e:
        logger.error(f"Error in ai_arbitrate_dispute: {str(e)}")
        return jsonify({"ok": False, "error": str(e)}), 500

if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    print(f"[+] PS42 Rental Escrow Flask Backend running on http://127.0.0.1:{port}")
    app.run(host="0.0.0.0", port=port, debug=True)
