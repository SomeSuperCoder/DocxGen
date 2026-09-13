"""Подмена пакета vosk для тестов: модель не нужна, распознаватель возвращает русскую фразу."""
import json


class Model:
    def __init__(self, path):
        self.path = path


class KaldiRecognizer:
    def __init__(self, model, sample_rate):
        self.model = model

    def AcceptWaveform(self, data):
        return True

    def FinalResult(self):
        return json.dumps({"text": "прошу выделить ноутбук"}, ensure_ascii=False)
