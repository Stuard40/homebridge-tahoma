import { Characteristics } from '../../Platform';
import { Command } from 'overkiz-client';
import HeatingSystem from '../HeatingSystem';

export default class AtlanticPassAPCHeatingAndCoolingZone extends HeatingSystem { 
    private refreshStatesTimeout;

    protected registerServices() {
        this.registerThermostatService();
        this.targetState?.setProps({ 
            validValues: [
                Characteristics.TargetHeatingCoolingState.AUTO,
                Characteristics.TargetHeatingCoolingState.HEAT,
                Characteristics.TargetHeatingCoolingState.OFF,
            ],
            maxValue: 30,
        });
    }

    protected getTargetStateCommands(value): Command | Array<Command> {
        const heatingCooling = this.getHeatingCooling();
        const commands: Array<Command> = [];
        switch(value) {
            case Characteristics.TargetHeatingCoolingState.AUTO:
                commands.push(new Command('set' + heatingCooling + 'OnOffState', 'on'));
                commands.push(new Command('setPassAPC' + heatingCooling + 'Mode', 'internalScheduling'));
                break;

            case Characteristics.TargetHeatingCoolingState.HEAT:
                if(
                    this.device.hasCommand('setDerogationOnOffState') &&
                    this.device.get('io:PassAPC' + heatingCooling + 'ProfileState') === 'derogation'
                ) {
                    // AtlanticPassAPCHeatPump
                    commands.push(new Command('setDerogationOnOffState', 'off'));
                }
                commands.push(new Command('set' + heatingCooling + 'OnOffState', 'on'));
                commands.push(new Command('setPassAPC' + heatingCooling + 'Mode', 'manu'));
                this.targetTemperature?.updateValue(this.device.get('core:Comfort' + heatingCooling + 'TargetTemperatureState'));
                break;

            case Characteristics.TargetHeatingCoolingState.OFF:
                commands.push(new Command('set' + heatingCooling + 'OnOffState', 'off'));
                //commands.push(new Command('setHeatingOnOffState', 'on'));
                //commands.push(new Command('setPassAPCHeatingMode', 'absence'));
                break;
        }
        
        return commands;
    }

    protected getTargetTemperatureCommands(value): Command | Array<Command> {
        const heatingCooling = this.getHeatingCooling();
        if(this.targetState?.value === Characteristics.TargetHeatingCoolingState.AUTO) {

            if(this.device.hasCommand('setDerogatedTargetTemperature')) {
                // AtlanticPassAPCHeatPump
                return [
                    new Command('setDerogatedTargetTemperature', value),
                    new Command('setDerogationTime', this.derogationDuration),
                    new Command('setDerogationOnOffState', 'on'),
                ];
            } else {
                // AtlanticPassAPCZoneControl (need to be removed ?)
                return new Command('set' + heatingCooling + 'TargetTemperature', value);
            }
        } else {
            if(this.device.hasCommand('set' + heatingCooling + 'TargetTemperature')) {
                // AtlanticPassAPCZoneControl
                return new Command('set' + heatingCooling + 'TargetTemperature', value);
            } else {
                // AtlanticPassAPCHeatPump
                return new Command('setComfort' + heatingCooling + 'TargetTemperature', value);
            }
        }
    }

    protected onStateChanged(name, value) {
        switch(name) {
            case 'core:TemperatureState': this.onTemperatureUpdate(value); break;
            case 'core:TargetTemperatureState':
                this.targetTemperature?.updateValue(this.device.get('core:TargetTemperatureState'));
                break;
            case 'core:HeatingOnOffState':
            case 'core:CoolingOnOffState':
            case 'io:PassAPCHeatingModeState':
            case 'io:PassAPCCoolingModeState':
            case 'io:PassAPCHeatingProfileState':
            case 'io:PassAPCCoolingProfileState':
                this.postpone(this.computeStates);
        }
    }

    protected computeStates() {
        let targetState;
        const heatingCooling = this.getHeatingCooling();

        if(this.device.get('core:' + heatingCooling + 'OnOffState') === 'off') {
            targetState = Characteristics.TargetHeatingCoolingState.OFF;
            this.currentState?.updateValue(Characteristics.CurrentHeatingCoolingState.OFF);
        } else {
            if(heatingCooling === 'Heating') {
                this.currentState?.updateValue(Characteristics.CurrentHeatingCoolingState.HEAT);
            } else {
                this.currentState?.updateValue(Characteristics.CurrentHeatingCoolingState.COOL);
            }
            if(this.device.get('io:PassAPC' + heatingCooling + 'ModeState') === 'internalScheduling') {
                targetState = Characteristics.TargetHeatingCoolingState.AUTO;
            } else {
                targetState = Characteristics.TargetHeatingCoolingState.HEAT;
            }
        }
        
        if(this.targetState !== undefined && targetState !== undefined && this.isIdle) {
            this.targetState.updateValue(targetState);
        }
    }

    /**
     * Helpers
     */
    private getHeatingCooling() {
        const operatingMode = this.device.parent?.get('io:PassAPCOperatingModeState');
        if(operatingMode === 'cooling') {
            return 'Cooling';
        } else {
            return 'Heating';
        }
    }

    private launchRefreshStates() {
        clearTimeout(this.refreshStatesTimeout);
        this.refreshStatesTimeout = setTimeout(() => {
            const commands = [
                new Command('refreshTargetTemperature'),
                new Command('refreshPassAPCHeatingProfile'),
            ];
            this.executeCommands(commands);
        }, 30 * 1000);
    }

    private launchRefreshTemperature() {
        clearTimeout(this.refreshStatesTimeout);
        this.refreshStatesTimeout = setTimeout(() => {
            this.executeCommands(new Command('refreshTargetTemperature'));
        }, 30 * 1000);
    }
}