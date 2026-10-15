import { describe, beforeEach, afterEach, test, expect, vi } from 'vitest';
import { AppStatus } from '../../types/appStatus';
import type { PlaybackState } from '../playbackManager';

/**
 * `play()` is called from the CAF PLAY event and is what switches the receiver's view to
 * the playing state. It reads the current status through DocumentManager, so both that and
 * window.playerManager are mocked here rather than pulling in the whole receiver.
 *
 * The CAF globals have to exist before the imports below run: `codecSupportHelper` does
 * `cast.framework.CastReceiverContext.getInstance()` at module scope, and importing
 * `play()` reaches it through playbackManager. `vi.hoisted` runs ahead of the imports.
 */
const mocks = vi.hoisted(() => {
    const context = {
        canDisplayType: (): boolean => false,
        getPlayerManager: (): unknown => ({})
    };

    // @ts-expect-error cast is defined by the CAF framework at runtime.
    globalThis.cast = {
        framework: {
            CastReceiverContext: { getInstance: (): unknown => context }
        }
    };

    return {
        status: '' as string,
        play: vi.fn(),
        setAppStatus: vi.fn()
    };
});

vi.mock('../documentManager', () => ({
    DocumentManager: {
        getAppStatus: (): string => mocks.status,
        setAppStatus: (status: string): void => {
            mocks.status = status;
            mocks.setAppStatus(status);
        }
    }
}));

// Importing `play()` reaches these through jellyfinActions, and both run module-scope CAF
// side effects (maincontroller grabs castReceiverContext and configures the player manager,
// which calls straight back into DocumentManager). None of that is under test here.
vi.mock('../playbackManager', () => ({
    PlaybackManager: {
        playbackState: {},
        resetPlaybackScope: vi.fn(),
        setPlayerManager: vi.fn()
    }
}));

vi.mock('../maincontroller', () => ({}));

import { play } from '../jellyfinActions';

const asPlaybackState = (mediaType: string): PlaybackState =>
    ({ mediaType }) as PlaybackState;

describe('play() view switching', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        mocks.play.mockClear();
        mocks.setAppStatus.mockClear();
        // @ts-expect-error window.playerManager is provided by the CAF framework at runtime.
        globalThis.window = { playerManager: { play: mocks.play } };
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    /**
     * The regression this exists for. When a load replaces media that is already playing,
     * CAF aborts the outgoing media and the ABORT handler runs onStop(), which sets Waiting.
     * That abort can land after the new load's Backdrop but before the new media reaches
     * PLAY, so `play()` is entered with the status already back at Waiting. If Waiting is
     * not accepted here the whole block is skipped, the body class stays `waiting`, and
     * `.waiting > #video-player { display: none }` hides the picture while the audio and the
     * reported position carry on - the TV sits on the ready screen during real playback.
     */
    test('recovers the video view when a stale stop left the status on Waiting', () => {
        mocks.status = AppStatus.Waiting;

        play(asPlaybackState('Video'));
        vi.advanceTimersByTime(20);

        expect(mocks.setAppStatus).toHaveBeenCalledWith(
            AppStatus.PlayingWithControls
        );
        expect(mocks.play).toHaveBeenCalled();
    });

    test('switches to the audio view for audio items', () => {
        mocks.status = AppStatus.Waiting;

        play(asPlaybackState('Audio'));
        vi.advanceTimersByTime(20);

        expect(mocks.setAppStatus).toHaveBeenCalledWith(AppStatus.Audio);
    });

    test('still switches from Backdrop', () => {
        mocks.status = AppStatus.Backdrop;

        play(asPlaybackState('Video'));
        vi.advanceTimersByTime(20);

        expect(mocks.setAppStatus).toHaveBeenCalledWith(
            AppStatus.PlayingWithControls
        );
    });

    /**
     * The details view is set deliberately by DisplayContent while playback continues, so
     * `play()` must not stomp it. This is the one status the change above leaves excluded.
     */
    test('leaves the details view alone', () => {
        mocks.status = AppStatus.Details;

        play(asPlaybackState('Video'));
        vi.advanceTimersByTime(20);

        expect(mocks.setAppStatus).not.toHaveBeenCalled();
        expect(mocks.play).not.toHaveBeenCalled();
    });
});
