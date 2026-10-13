
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import '@girs/gnome-shell/extensions/global';
import { Extension } from
    'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const ACCENT = '#E6005C';
const START_THRESHOLD = 12;
const STEP_THRESHOLD = 70;
const HORIZONTAL_RATIO = 1.5;

export default class WindowSwipeSwitcher extends Extension {
    enable() {
        this._eventId = 0;
        this._candidate = false;
        this._claimed = false;
        this._dx = 0;
        this._dy = 0;
        this._windows = [];
        this._cards = [];
        this._popup = null;
        this._selectedIndex = 0;
        this._activeIndex = 0;
        this._workspaceGesture = null;
        this._originalFingerCount = null;

        this._reserveWorkspaceSwipeForFourFingers();

        this._eventId = global.stage.connect(
            'captured-event',
            (_stage, event) => this._onEvent(event)
        );

        console.log('[WindowSwipe] Enabled');
    }

    _reserveWorkspaceSwipeForFourFingers() {
        // Change only GNOME's horizontal workspace tracker.
        const tracker =
            Main.wm?._workspaceAnimation?._swipeTracker;
        const gesture = tracker?._touchpadGesture;

        if (!gesture) {
            console.error(
                '[WindowSwipe] Workspace tracker not found. ' +
                'The workspace gesture has NOT been changed.'
            );
            return;
        }

        try {
            this._workspaceGesture = gesture;
            this._originalFingerCount =
                gesture.get_property('n-touch-points');

            gesture.set_property('n-touch-points', 4);

            // console.log(
            //     '[WindowSwipe] Workspace gesture now uses four fingers; ' +
            //     `previous count: ${this._originalFingerCount}`
            // );
        } catch (error) {
            this._workspaceGesture = null;
            this._originalFingerCount = null;

            console.error(
                `[WindowSwipe] Could not update workspace gesture: ${error}`
            );
        }
    }

    _onEvent(event) {
        if (event.type() !== Clutter.EventType.TOUCHPAD_SWIPE)
            return Clutter.EVENT_PROPAGATE;

        // Do not intercept four-finger or other gestures.
        if (event.get_touchpad_gesture_finger_count() !== 3)
            return Clutter.EVENT_PROPAGATE;

        const phase = event.get_gesture_phase();

        if (phase === Clutter.TouchpadGesturePhase.BEGIN) {
            this._candidate = true;
            this._claimed = false;
            this._dx = 0;
            this._dy = 0;
            return Clutter.EVENT_PROPAGATE;
        }

        if (!this._candidate && !this._claimed)
            return Clutter.EVENT_PROPAGATE;

        if (phase === Clutter.TouchpadGesturePhase.UPDATE) {
            const [dx, dy] = event.get_gesture_motion_delta();
            this._dx += dx;
            this._dy += dy;

            if (!this._claimed) {
                const x = Math.abs(this._dx);
                const y = Math.abs(this._dy);

                if (Math.max(x, y) < START_THRESHOLD)
                    return Clutter.EVENT_PROPAGATE;

                // Vertical three-finger gestures remain untouched.
                if (y > x / HORIZONTAL_RATIO) {
                    this._candidate = false;
                    return Clutter.EVENT_PROPAGATE;
                }

                this._windows = this._getWindows();

                if (this._windows.length < 2) {
                    this._candidate = false;
                    return Clutter.EVENT_PROPAGATE;
                }

                this._claimed = true;

                const focused = global.display.get_focus_window();
                this._activeIndex = this._windows.indexOf(focused);

                if (this._activeIndex < 0)
                    this._activeIndex = 0;

                this._selectedIndex = this._activeIndex;
                this._showPopup();
            }

            this._updateSelection();
            return Clutter.EVENT_STOP;
        }

        if (phase === Clutter.TouchpadGesturePhase.END) {
            if (this._claimed) {
                const target = this._windows[this._selectedIndex];

                this._closePopup();

                if (target)
                    target.activate(global.get_current_time());

                this._resetGesture();
                return Clutter.EVENT_STOP;
            }

            this._resetGesture();
            return Clutter.EVENT_PROPAGATE;
        }

        if (phase === Clutter.TouchpadGesturePhase.CANCEL) {
            const claimed = this._claimed;

            this._closePopup();
            this._resetGesture();

            return claimed
                ? Clutter.EVENT_STOP
                : Clutter.EVENT_PROPAGATE;
        }

        return this._claimed
            ? Clutter.EVENT_STOP
            : Clutter.EVENT_PROPAGATE;
    }

    _getWindows() {
        const workspace =
            global.workspace_manager.get_active_workspace();

        return global.display.get_tab_list(
            Meta.TabList.NORMAL,
            workspace
        ).filter(window =>
            window &&
            !window.is_skip_taskbar() &&
            window.get_compositor_private() !== null
        );
    }

    _updateSelection() {
        const distance = Math.abs(this._dx);
        const steps = Math.max(
            1,
            1 + Math.floor(
                Math.max(0, distance - START_THRESHOLD) /
                STEP_THRESHOLD
            )
        );

        const direction = this._dx < 0 ? 1 : -1;

        this._selectedIndex =
            (this._activeIndex +
                direction * steps +
                this._windows.length * (steps + 1)) %
            this._windows.length;

        this._highlightSelection();
    }

    _showPopup() {
        if (this._popup)
            return;

        this._popup = new St.BoxLayout({
            vertical: true,
            style: `
                background-color: rgba(24, 24, 30, 0.97);
                border: 1px solid rgba(255,255,255,0.16);
                border-radius: 18px;
                padding: 18px;
                spacing: 12px;
            `,
        });

        this._popup.add_child(new St.Label({
            text: 'Switch window',
            style: 'font-size: 16px; font-weight: bold; color: white;',
            x_align: Clutter.ActorAlign.CENTER,
        }));

        const row = new St.BoxLayout({
            vertical: false,
            style: 'spacing: 10px;',
        });

        this._cards = [];

        for (const window of this._windows) {
            const card = new St.BoxLayout({
                vertical: true,
                width: 200,
                style: `
                    background-color: rgba(255,255,255,0.06);
                    border: 2px solid transparent;
                    border-radius: 12px;
                    padding: 10px;
                    spacing: 8px;
                `,
            });

            const app = Shell.WindowTracker.get_default()
                .get_window_app(window);

            const titleRow = new St.BoxLayout({
                vertical: false,
                style: 'spacing: 8px;',
            });

            let icon;
            try {
                icon = app
                    ? app.create_icon_texture(28)
                    : new St.Icon({
                        icon_name: 'application-x-executable-symbolic',
                        icon_size: 28,
                    });
            } catch (_) {
                icon = new St.Icon({
                    icon_name: 'application-x-executable-symbolic',
                    icon_size: 28,
                });
            }

            titleRow.add_child(icon);

            const label = new St.Label({
                text: window.get_title() ||
                    app?.get_name() ||
                    'Untitled window',
                style: 'color: white; font-size: 12px;',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });

            label.clutter_text.ellipsize = 3;
            titleRow.add_child(label);
            card.add_child(titleRow);

            const source = window.get_compositor_private();

            if (source) {
                try {
                    const preview = new Clutter.Clone({
                        source,
                        reactive: false,
                    });

                    preview.set_size(180, 105);

                    const frame = new St.Widget({
                        width: 180,
                        height: 105,
                        clip_to_allocation: true,
                        style: 'background-color: #18181e; border-radius: 8px;',
                    });

                    frame.add_child(preview);
                    card.add_child(frame);
                } catch (error) {
                    console.debug(
                        `[WindowSwipe] Preview unavailable: ${error.message}`
                    );
                }
            }

            row.add_child(card);
            this._cards.push(card);
        }

        this._popup.add_child(row);
        Main.uiGroup.add_child(this._popup);
        this._popup.set_position(0, 0);

        const [, width] = this._popup.get_preferred_width(-1);
        const [, height] = this._popup.get_preferred_height(width);
        const monitor = Main.layoutManager.primaryMonitor;

        this._popup.set_position(
            monitor.x + Math.max(0, (monitor.width - width) / 2),
            monitor.y + Math.max(0, (monitor.height - height) / 2)
        );

        this._popup.set_size(width, height);
        this._highlightSelection();
    }

    _highlightSelection() {
        this._cards.forEach((card, index) => {
            card.set_style(index === this._selectedIndex
                ? `
                    background-color: rgba(230,0,92,0.22);
                    border: 2px solid ${ACCENT};
                    border-radius: 12px;
                    padding: 10px;
                    spacing: 8px;
                `
                : `
                    background-color: rgba(255,255,255,0.06);
                    border: 2px solid transparent;
                    border-radius: 12px;
                    padding: 10px;
                    spacing: 8px;
                `);
        });
    }

    _closePopup() {
        if (this._popup) {
            this._popup.destroy();
            this._popup = null;
        }

        this._cards = [];
    }

    _resetGesture() {
        this._candidate = false;
        this._claimed = false;
        this._dx = 0;
        this._dy = 0;
        this._windows = [];
        this._activeIndex = 0;
        this._selectedIndex = 0;
    }

    disable() {
        if (this._eventId) {
            global.stage.disconnect(this._eventId);
            this._eventId = 0;
        }

        this._closePopup();
        this._resetGesture();

        if (this._workspaceGesture &&
            this._originalFingerCount !== null) {
            try {
                this._workspaceGesture.set_property(
                    'n-touch-points',
                    this._originalFingerCount
                );
            } catch (error) {
                console.error(
                    `[WindowSwipe] Could not restore workspace gesture: ${error}`
                );
            }
        }

        this._workspaceGesture = null;
        this._originalFingerCount = null;

        console.log('[WindowSwipe] Disabled');
    }
}
