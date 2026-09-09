from xauusd_scalp_engine import ScalpFeatures, evaluate


def test_long_signal():
    f = ScalpFeatures(4350,4352,4348,4340,58,60,0.12,32,0.08,0.8,0.7,1.5,25,0.9,0.78)
    d = evaluate(f)
    assert d.signal == "LONG"
    assert d.stop is not None and d.target is not None


def test_short_signal():
    f = ScalpFeatures(4350,4348,4352,4360,42,40,0.12,32,-0.08,-0.8,-0.7,1.5,25,-0.9,0.22)
    d = evaluate(f)
    assert d.signal == "SHORT"


def test_spread_filter():
    f = ScalpFeatures(4350,4352,4348,4340,58,60,0.12,32,0.08,0.8,0.7,1.5,200,0.9,0.78)
    assert evaluate(f).signal == "NO_TRADE"
