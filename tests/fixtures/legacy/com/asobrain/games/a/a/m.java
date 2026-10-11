package com.asobrain.games.a.a;

import java.awt.Frame;

/** Owned synthetic fixture for the verified old API names; no original game code. */
public class m {
    public Frame i;
    public static String[] captured;

    public void a(String[] args) {
        captured = args.clone();
    }

    public void a(String value) {
        throw new AssertionError("Selected the wrong overload");
    }
}
