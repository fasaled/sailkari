#!/usr/bin/env node

import { render } from "ink";
import React from "react";
import { App } from "./tui.js";

render(<App />, { alternateScreen: true });
