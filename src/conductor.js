/**
 * Band.js - Music Composer
 * An interface for the Web Audio API that supports rhythms, multiple instruments, repeating sections, and complex
 * time signatures.
 *
 * @author Cody Lundquist (http://github.com/meenie) - 2013
 */
module.exports = BandJS;

var packs = {
        instrument: {},
        rhythm: {},
        tuning: {}
    },
    noop = function() {};

function BandJS(tuning, rhythm) {
    if (! tuning) {
        tuning = 'equalTemperament';
    }

    if (! rhythm) {
        rhythm = 'northAmerican';
    }

    if (typeof packs.tuning[tuning] === 'undefined') {
        throw new Error(tuning + ' is not a valid tuning pack.');
    }

    if (typeof packs.rhythm[rhythm] === 'undefined') {
        throw new Error(rhythm + ' is not a valid rhythm pack.');
    }

    var conductor = this,
        AudioContext = require('audiocontext'),
        signatureToNoteLengthRatio = {
            2: 6,
            4: 3,
            8: 4.50
        };

    conductor.packs = packs;
    conductor.pitches = packs.tuning[tuning];
    conductor.notes = packs.rhythm[rhythm];
    conductor.audioContext = new AudioContext();
    conductor.masterVolumeLevel = null;
    conductor.masterVolume = conductor.audioContext.createGain();
    conductor.masterVolume.connect(conductor.audioContext.destination);
    conductor.beatsPerBar = null;
    conductor.noteGetsBeat = null;
    conductor.tempo = null;
    conductor.instruments = [];
    conductor.totalDuration = 0;
    conductor.onTickerCallback = noop;
    conductor.onFinishedCallback = noop;

    /**
     * Use JSON to load in a song to be played
     *
     * @param json
     */
    conductor.load = function(json) {
        if (! json) {
            throw new Error('JSON is required for this method to work.');
        }
        // Need to have at least instruments and notes
        if (typeof json['instruments'] === 'undefined') {
            throw new Error('You must define at least one instrument');
        }
        if (typeof json['notes'] === 'undefined') {
            throw new Error('You must define notes for each instrument');
        }

        // Shall we set a time signature?
        if (typeof json['timeSignature'] !== 'undefined') {
            conductor.setTimeSignature(json['timeSignature'][0], json['timeSignature'][1]);
        }

        // Maybe some tempo?
        if (typeof json['tempo'] !== 'undefined') {
            conductor.setTempo(json['tempo']);
        }

        // Lets create some instruments
        var instrumentList = {};
        for (var instrument in json['instruments']) {
            if (! json['instruments'].hasOwnProperty(instrument)) {
                continue;
            }

            instrumentList[instrument] = conductor.createInstrument(
                json['instruments'][instrument].name,
                json['instruments'][instrument].pack
            );
        }

        // Now lets add in each of the notes
        for (var inst in json['notes']) {
            if (! json['notes'].hasOwnProperty(inst)) {
                continue;
            }
            var index = - 1;
            while (++ index < json['notes'][inst].length) {
                var note = json['notes'][inst][index];
                // Use shorthand if it's a string
                if (typeof note === 'string') {
                    var noteParts = note.split('|');
                    if ('rest' === noteParts[1]) {
                        instrumentList[inst].rest(noteParts[0]);
                    } else {
                        instrumentList[inst].note(noteParts[0], noteParts[1], noteParts[2]);
                    }
                    // Otherwise use longhand
                } else {
                    if ('rest' === note.type) {
                        instrumentList[inst].rest(note.rhythm);
                    } else if ('note' === note.type) {
                        instrumentList[inst].note(note.rhythm, note.pitch, note.tie);
                    }
                }
            }
        }

        // Looks like we are done, lets press it.
        return conductor.finish();
    };

    /**
     * Create a new instrument
     *
     * @param [name] - defaults to sine
     * @param [pack] - defaults to oscillators
     */
    conductor.createInstrument = function(name, pack) {
        var instrument = require('./instrument.js')(name, pack, conductor);
        conductor.instruments.push(instrument);

        return instrument;
    };

    /**
     * Needs to be called after all the instruments have been filled with notes.
     * It will figure out the total duration of the song based on the longest
     * duration out of all the instruments.  It will then pass back the Player Object
     * which is used to control the music (play, stop, pause, loop, volume, tempo)
     *
     * It returns the Player object.
     */
    conductor.finish = function() {
        var index = -1;
        var totalDuration = 0;
        while (++index < conductor.instruments.length) {
            var instrument = conductor.instruments[index];
            if (instrument.totalDuration > totalDuration) {
                totalDuration = instrument.totalDuration;
            }
        }

        conductor.totalDuration = totalDuration;

        console.log('finish');
        return require('./player.js')(conductor);
    };

    /**
     * Set Master Volume
     */
    conductor.setMasterVolume = function(volume) {
        if (volume > 1) {
            volume = volume / 100;
        }
        conductor.masterVolumeLevel = volume;
        conductor.masterVolume.gain.value = volume;
    };

    /**
     * Grab the total duration of a song
     *
     * @returns {number}
     */
    conductor.getTotalSeconds = function() {
        return Math.round(conductor.totalDuration);
    };

    /**
     * Sets the ticker callback function. This function will be called
     * every time the current seconds has changed.
     *
     * @param cb function
     */
    conductor.setTickerCallback = function(cb) {
        if (typeof cb !== 'function') {
            throw new Error('Ticker must be a function.');
        }

        conductor.onTickerCallback = cb;
    };

    /**
     * Sets the time signature for the music. Just like in notation 4/4 time would be setTimeSignature(4, 4);
     * @param top - Number of beats per bar
     * @param bottom - What note type has the beat
     */
    conductor.setTimeSignature = function(top, bottom) {
        if (typeof signatureToNoteLengthRatio[bottom] === 'undefined') {
            throw new Error('The bottom time signature is not supported.');
        }

        // Not used at the moment, but will be handy in the future.
        conductor.beatsPerBar = top;
        conductor.noteGetsBeat = signatureToNoteLengthRatio[bottom];
    };

    /**
     * Sets the tempo
     *
     * @param t
     */
    conductor.setTempo = function(t) {
        conductor.tempo = 60 / t;
    };

    /**
     * Set a callback to fire when the song is finished
     *
     * @param cb
     */
    conductor.setOnFinished = function(cb) {
        if (typeof cb !== 'function') {
            throw new Error('onFinished callback must be a function.');
        }

        conductor.onFinishedCallback = cb;
    };

    conductor.setMasterVolume(100);
    conductor.setTempo(120);
    conductor.setTimeSignature(4, 4);
}

BandJS.loadPack = function(type, name, data) {
    if (['tuning', 'rhythm', 'instrument'].indexOf(type) === - 1) {
        throw new Error(type = ' is not a valid Pack Type.');
    }

    if (typeof packs[type][name] !== 'undefined') {
        throw new Error('A(n) ' + type + ' pack with the name "' + name + '" has already been loaded.');
    }

    packs[type][name] = data;
};

BandJS.loadPack('instrument', 'noises', require('./instrument-packs/noises.js'));
BandJS.loadPack('instrument', 'oscillators', require('./instrument-packs/oscillators.js'));
BandJS.loadPack('rhythm', 'northAmerican', require('./rhythm-packs/north-american.js'));
BandJS.loadPack('rhythm', 'european', require('./rhythm-packs/european.js'));
BandJS.loadPack('tuning', 'equalTemperament', require('./tuning-packs/equal-temperament.js'));