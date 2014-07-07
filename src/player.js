module.exports = function(conductor) {
    var allSounds = [],
        bufferTimeout,
        defaultBufferSize = 50,
        currentPlayTime,
        totalPlayTime = 0,
        currentSeconds = 0,
        faded = false;

    /**
     * Helper function to stop all sound nodes
     * then call methods.end() to re-buffer them
     */
    function reset() {
        // Reset the buffer position of all instruments
        var index = - 1;
        while (++index < conductor.instruments.length) {
            conductor.instruments[index].bufferPosition = 0;
        }

        index = - 1;
        while (++index < allSounds.length) {
            allSounds[index].gain.disconnect();
        }

        clearTimeout(bufferTimeout);

        allSounds = bufferSounds();
    }

    /**
     * Helper function to fade up/down master volume
     *
     * @param direction - up or down
     * @param [cb] - Callback function fired after the transition is completed
     * @param [resetVolume] - Reset the volume back to it's original level
     */
    function fade(direction, cb, resetVolume) {
        if (typeof resetVolume === 'undefined') {
            resetVolume = false;
        }
        if ('up' !== direction && 'down' !== direction) {
            throw new Error('Direction must be either up or down.');
        }
        faded = direction === 'down';
        var i = 100 * conductor.masterVolumeLevel,
            fadeTimer = function() {
                if (i > 0) {
                    i = i - 4;
                    i = i < 0 ? 0 : i;
                    var gain = 'up' === direction ? conductor.masterVolumeLevel * 100 - i : i;
                    conductor.masterVolume.gain.value = gain / 100;
                    requestAnimationFrame(fadeTimer);
                } else {
                    if (typeof cb === 'function') {
                        cb();
                    }

                    if (resetVolume) {
                        faded = ! faded;
                        conductor.masterVolume.gain.value = conductor.masterVolumeLevel;
                    }
                }
            };

        fadeTimer();
    }

    /**
     * Grabs a set of sounds based on the current time and what the Buffer Size is.
     * It will also skip any sounds that have a start time less than the
     * total play time.
     */
    function bufferSounds(bufferSize) {
        // Default buffer amount to 50 notes
        if (! bufferSize) {
            bufferSize = defaultBufferSize;
        }

        var sounds = [];
        var index = - 1;
        while (++index < conductor.instruments.length) {
            var instrument = conductor.instruments[index];
            // Create volume for this instrument
            var bufferCount = bufferSize;
            var index2 = - 1;
            while (++index2 < bufferCount) {
                var sound = instrument.sounds[instrument.bufferPosition + index2];

                if (typeof sound === 'undefined') {
                    break;
                }

                var pitch = sound.pitch,
                    startTime = sound.startTime,
                    stopTime = sound.stopTime,
                    volumeLevel = sound.volumeLevel;

                if (startTime < totalPlayTime) {
                    bufferCount ++;
                    continue;
                }

                // If pitch is false, then it's a rest and we don't need a sound
                if (false === pitch) {
                    continue;
                }

                var gain = conductor.audioContext.createGain();
                // Connect volume gain to the Master Volume;
                gain.connect(conductor.masterVolume);
                gain.gain.value = volumeLevel;

                // No pitches defined
                if (typeof pitch === 'undefined') {
                    sounds.push({
                        startTime: startTime,
                        stopTime: stopTime,
                        node: instrument.instrument.createSound(gain),
                        gain: gain,
                        volumeLevel: volumeLevel
                    });
                } else {
                    var index3 = - 1;
                    while (++index3 < pitch.length) {
                        var p = pitch[index3];
                        sounds.push({
                            startTime: startTime,
                            stopTime: stopTime,
                            node: instrument.instrument.createSound(gain, conductor.pitches[p.trim()] || parseFloat(p)),
                            gain: gain,
                            volumeLevel: volumeLevel
                        });
                    }
                }
            }
            instrument.bufferPosition += bufferCount;
        }

        // Return array of sounds
        return sounds;
    }

    function totalPlayTimeCalculator() {
        if (! definitions.paused && definitions.playing) {
            if (conductor.totalDuration < totalPlayTime) {
                definitions.stop(false);
                if (definitions.looping) {
                    definitions.play();
                } else  {
                    conductor.onFinishedCallback();
                }
            } else {
                updateTotalPlayTime();
                requestAnimationFrame(totalPlayTimeCalculator);
            }
        }
    }

    /**
     * Call to update the total play time so far
     */
    function updateTotalPlayTime() {
        totalPlayTime += conductor.audioContext.currentTime - currentPlayTime;
        var seconds = Math.round(totalPlayTime);
        if (seconds != currentSeconds) {
            // Make callback asynchronous
            setTimeout(function() {
                conductor.onTickerCallback(seconds);
            }, 1);
            currentSeconds = seconds;
        }
        currentPlayTime = conductor.audioContext.currentTime;
    }

    var definitions = {
        paused: false,
        playing: false,
        looping: false,
        muted: false,
        /**
         * Grabs currently buffered sound nodes and calls their start/stop methods.
         *
         * It then sets up a timer to buffer up the next set of notes based on the
         * a set buffer size.  This will keep going until the song is stopped or paused.
         *
         * It will use the total time played so far as an offset so you pause/play the music
         */
        play: function() {
            definitions.playing = true;
            definitions.paused = false;
            currentPlayTime = conductor.audioContext.currentTime;
            // Starts calculator which keeps track of total play time
            totalPlayTimeCalculator();
            var timeOffset = conductor.audioContext.currentTime - totalPlayTime,
                playSounds = function(sounds) {
                    var index = - 1;
                    while (++index < sounds.length) {
                        var sound = sounds[index];
                        var startTime = sound.startTime + timeOffset,
                            stopTime = sound.stopTime + timeOffset;

                        /**
                         * If no tie, then we need to introduce a volume ramp up to remove any clipping
                         * as Oscillators have an issue with this when playing a note at full volume.
                         * We also put in a slight ramp down as well.  This only takes up 1/1000 of a second.
                         */
                        if (! sound.tie) {
                            startTime -= 0.001;
                            stopTime += 0.001;
                            sound.gain.gain.setValueAtTime(0.0, startTime);
                            sound.gain.gain.linearRampToValueAtTime(sound.volumeLevel, startTime + 0.001);
                            sound.gain.gain.setValueAtTime(sound.volumeLevel, stopTime - 0.001);
                            sound.gain.gain.linearRampToValueAtTime(0.0, stopTime);
                        }

                        sound.node.start(startTime);
                        sound.node.stop(stopTime);
                    }
                },
                bufferUp = function() {
                    bufferTimeout = setTimeout(function() {
                        if (definitions.playing && ! definitions.paused) {
                            var newSounds = bufferSounds();
                            if (newSounds.length > 0) {
                                playSounds(newSounds);
                                allSounds = allSounds.concat(newSounds);
                                bufferUp();
                            }
                        }
                    }, 5000);
                };

            playSounds(allSounds);
            bufferUp();

            if (faded && ! definitions.muted) {
                fade('up');
            }
        },
        /**
         * Stop playing all music and rewind the song
         *
         * @param fadeOut boolean - should the song fade out?
         */
        stop: function(fadeOut) {
            definitions.playing = false;
            currentSeconds = 0;

            if (typeof fadeOut === 'undefined') {
                fadeOut = true;
            }
            if (fadeOut && ! definitions.muted) {
                fade('down', function() {
                    totalPlayTime = 0;
                    reset();
                    // Make callback asynchronous
                    setTimeout(function() {
                        conductor.onTickerCallback(currentSeconds);
                    }, 1);
                }, true);
            } else {
                totalPlayTime = 0;
                reset();
                // Make callback asynchronous
                setTimeout(function() {
                    conductor.onTickerCallback(currentSeconds);
                }, 1);
            }
        },
        /**
         * Pauses the music, resets the sound nodes,
         * and gets the total time played so far
         */
        pause: function() {
            definitions.paused = true;
            updateTotalPlayTime();
            if (definitions.muted) {
                reset();
            } else {
                fade('down', function() {
                    reset();
                });
            }
        },

        /**
         * Set true if you want the song to loop
         *
         * @param val
         */
        loop: function(val) {
            definitions.looping = !! val;
        },

        /**
         * Set a specific time that the song should start it.
         * If it's already playing, reset and start the song
         * again so it has a seamless jump.
         *
         * @param newTime
         */
        setTime: function(newTime) {
            totalPlayTime = parseInt(newTime);
            reset();
            if (definitions.playing && ! definitions.paused) {
                definitions.play();
            }
        },
        /**
         * Mute all of the music
         */
        mute: function(cb) {
            definitions.muted = true;
            fade('down', cb);
        },
        /**
         * Unmute all of the music
         */
        unmute: function(cb) {
            definitions.muted = false;
            fade('up', cb);
        }
    };

    allSounds = bufferSounds();

    return definitions;
};
