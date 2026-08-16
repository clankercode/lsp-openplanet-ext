// packages/grammar/testcorpus/sample.as — grammar test corpus.
// Each region below exercises constructs the grammar must highlight.
// Consumed by tests/scopes.test.ts via vscode-textmate.

// ── preprocessor ──
#include "SomeLib/Main.as"
#include <Other/Util.as>
#include "Shared/Math.as" as Math
#define DEV 1
#undef DEV
#if TMNEXT
const string Game = "TM";
#elif MP4
const string Game = "MP4";
#else
const string Game = "?";
#endif
#if DEPENDENCY_MLHOOK && SIG_DEVELOPER
#endif
#if !DEV
#endif

// ── meta attributes (Openplanet) ──
[Setting hidden]
int SomeHidden = 3;
[Setting name="Visible setting" description="Desc here"]
int SomeSetting = 7;
[SettingsTab name="State" icon="Th" order="1"]

// ── strings ──
void Strings() {
    string a = "double \"quoted\" with \\ escapes";
    string b = 'single \'quoted\' with \\ escapes';
    string ml = """triple "quoted" multi-line
    still string ${not_interp}
    end""";
}

// ── numbers ──
void Numbers() {
    int hex = 0xFF;
    int hexs = 0xDE_AD_BEEF;
    int bin = 0b1010_0110;
    int oct = 0o777;
    float f1 = 25.5;
    float f2 = 25.5e2;
    float f3 = 25.;
    float f4 = 25.f;
    float f5 = 0.5f;
    int m = 25; // bare int (member-access case below must not eat it)
    25.foo(); // grammar probe: `25` + `.foo`, NOT `25.` + `foo`
    int i = 1000000;
    float fe = 1e10;
    float fen = 1e-10;
}

// ── keywords / modifiers / types ──
namespace Foo {
    mixin class Bar {}
    shared void Global() {}
    private int _x;
    protected bool _ok;
    class Baz : Foo::Bar {
        int Prop { get { return _x; } set { _x = value; } }
        final void NoOverride() {}
        override void Render() {}
    }
}

// ── handles / namespaces / word operators ──
void Handles() {
    CGameCtnApp@ app = cast<CGameCtnApp@>(GetApp());
    auto@ handle = @app;
    if (app is null and not app.Initialized or false) return;
    int bits = 3 & 1 | 2 ^ 7;
    M::Fast fa = M::Fast::Fastest;
    UI::ShowNotification("t", "m");
    Meta::ExecutionMode mode = Meta::ExecutionMode::Game;
}
