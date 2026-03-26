import os
import random
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)


def _validate_request_data(data):
    if not data or 'frame' not in data or not data.get('frame'):
        return False
    return True


def _simulate_cheating_analysis(frame_data):
    base_score = random.uniform(0.0, 1.0)
    cheating_score = round(base_score * 100, 2)
    warnings = []

    if base_score > 0.75:
        warnings.append('multiple_faces_detected')
    elif base_score > 0.55:
        warnings.append('gaze_away_detected')
    elif base_score > 0.4:
        warnings.append('glance_off_camera')

    status = 'suspicious' if cheating_score >= 60 or warnings else 'safe'
    return cheating_score, warnings, status


def _make_response(cheating_score, warnings, status):
    return {
        'cheating_score': cheating_score,
        'warnings': warnings,
        'status': status,
    }


@app.route('/', methods=['GET'])
def root():
    return 'Backend is running', 200


@app.route('/analyze_frame', methods=['POST'])
def analyze_frame():
    if not request.is_json:
        return jsonify({'error': 'Invalid JSON payload'}), 400

    data = request.get_json(silent=True)
    if not _validate_request_data(data):
        return jsonify({'error': 'Frame data missing'}), 400

    frame_data = data.get('frame')
    cheating_score, warnings, status = _simulate_cheating_analysis(frame_data)
    response = _make_response(cheating_score, warnings, status)
    return jsonify(response), 200


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 10000))
    app.run(host='0.0.0.0', port=port)

