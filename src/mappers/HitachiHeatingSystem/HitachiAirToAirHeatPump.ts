import { Characteristics, Services } from '../../Platform';
import { Characteristic, Service } from 'homebridge';
import { Command } from 'overkiz-client';
import HeatingSystem from '../HeatingSystem';

export default class HitachiAirToAirHeatPump extends HeatingSystem {
    protected MIN_TEMP = 16;
    protected MAX_TEMP = 30;
    protected MIN_STEP = 1;
    protected TARGET_MODES = [
        Characteristics.TargetHeatingCoolingState.AUTO,
        Characteristics.TargetHeatingCoolingState.HEAT,
        Characteristics.TargetHeatingCoolingState.COOL,
        Characteristics.TargetHeatingCoolingState.OFF,
    ];

    protected fanService: Service | undefined;
    protected fanOn: Characteristic | undefined;
    protected rotationSpeed: Characteristic | undefined;

    protected registerServices(): Array<Service> {
        const services = super.registerServices();

        const fanService = this.registerService(Services.Fan, 'Fan');
        this.fanService = fanService;

        this.fanOn = fanService.getCharacteristic(Characteristics.On);
        this.fanOn.onSet(async (value) => {
            if (value === this.fanOn?.value) {
                return;
            }
            const targetState = value ? Characteristics.TargetHeatingCoolingState.AUTO : Characteristics.TargetHeatingCoolingState.OFF;
            await this.setTargetState(targetState);
        });

        this.rotationSpeed = fanService.getCharacteristic(Characteristics.RotationSpeed);
        this.rotationSpeed.updateValue(100);
        this.rotationSpeed.setProps({
            minValue: 0,
            maxValue: 100,
            minStep: 20,
        });
        this.rotationSpeed.onSet(this.setRotationSpeed.bind(this));

        services.push(fanService);
        return services;
    }

    protected async setRotationSpeed(value) {
        let fanMode = 'auto';
        const speed = Math.round(value / 20) * 20;
        switch (speed) {
            case 0:
            case 20: fanMode = 'silent'; break;
            case 40: fanMode = 'lo'; break;
            case 60: fanMode = 'med'; break;
            case 80: fanMode = 'hi'; break;
            case 100: fanMode = 'auto'; break;
        }

        const commands = this.getCommandsWithFanMode(this.targetState?.value, this.targetTemperature?.value, fanMode);
        await this.executeCommands(commands);
    }

    protected getTargetStateCommands(value): Command | Array<Command> | undefined {
        return this.getCommands(value, this.targetTemperature?.value);
    }

    protected getTargetTemperatureCommands(value): Command | Array<Command> {
        return this.getCommands(this.targetState?.value, value);
    }

    protected onStateChanged(name: string, value) {
        switch (name) {
            case 'ovp:ModeChangeState':
            case 'ovp:MainOperationState':
                if (this.device.get('ovp:MainOperationState') === 'Off' || this.device.get('ovp:MainOperationState') === 'off') {
                    this.currentState?.updateValue(Characteristics.CurrentHeatingCoolingState.OFF);
                    this.targetState?.updateValue(Characteristics.TargetHeatingCoolingState.OFF);
                    this.fanOn?.updateValue(false);
                } else {
                    this.fanOn?.updateValue(true);
                    switch (this.device.get('ovp:ModeChangeState')?.toLowerCase()) {
                        case 'auto cooling':
                            this.currentState?.updateValue(Characteristics.CurrentHeatingCoolingState.COOL);
                            this.targetState?.updateValue(Characteristics.TargetHeatingCoolingState.AUTO);
                            break;
                        case 'auto heating':
                            this.currentState?.updateValue(Characteristics.CurrentHeatingCoolingState.HEAT);
                            this.targetState?.updateValue(Characteristics.TargetHeatingCoolingState.AUTO);
                            break;
                        case 'cooling':
                            this.currentState?.updateValue(Characteristics.CurrentHeatingCoolingState.COOL);
                            this.targetState?.updateValue(Characteristics.TargetHeatingCoolingState.COOL);
                            break;
                        case 'heating':
                            this.currentState?.updateValue(Characteristics.CurrentHeatingCoolingState.HEAT);
                            this.targetState?.updateValue(Characteristics.TargetHeatingCoolingState.HEAT);
                            break;
                    }
                }
                break;
            case 'ovp:RoomTemperatureState':
                this.onTemperatureUpdate(value);
                break;
            case 'core:TargetTemperatureState':
                this.targetTemperature?.updateValue(value);
                break;
            case 'ovp:FanSpeedState':
                let speed = 100;
                switch (value?.toLowerCase()) {
                    case 'silent': speed = 20; break;
                    case 'low':
                    case 'lo':
                        speed = 40;
                        break;
                    case 'medium':
                    case 'med':
                        speed = 60;
                        break;
                    case 'high':
                    case 'hi':
                        speed = 80;
                        break;
                    case 'auto': speed = 100; break;
                }
                this.rotationSpeed?.updateValue(speed);
                break;
        }
    }

    private getCommands(state, temperature) {
        let fanMode = 'auto';
        if (this.rotationSpeed) {
            const value = Number(this.rotationSpeed.value);
            const speed = Math.round(value / 20) * 20;
            switch (speed) {
                case 0:
                case 20: fanMode = 'silent'; break;
                case 40: fanMode = 'lo'; break;
                case 60: fanMode = 'med'; break;
                case 80: fanMode = 'hi'; break;
                case 100: fanMode = 'auto'; break;
            }
        }
        return this.getCommandsWithFanMode(state, temperature, fanMode);
    }

    private getCommandsWithFanMode(state, temperature, fanMode) {
        const currentState = this.currentState ? this.currentState.value : 0;
        const currentTemperature = this.currentTemperature && this.currentTemperature.value !== null ? this.currentTemperature.value : 0;
        let onOff = 'on';
        const progMode = 'manu';
        let heatMode = 'auto';
        const autoTemp = Math.trunc(Math.max(Math.min(temperature - parseInt(currentTemperature.toString()), 5), -5));

        switch (state) {
            case Characteristics.TargetHeatingCoolingState.OFF:
                onOff = 'off';
                switch (currentState) {
                    case Characteristics.CurrentHeatingCoolingState.HEAT:
                        heatMode = 'heating';
                        break;
                    case Characteristics.CurrentHeatingCoolingState.COOL:
                        heatMode = 'cooling';
                        break;
                    default:
                        temperature = autoTemp;
                        break;
                }
                break;

            case Characteristics.TargetHeatingCoolingState.HEAT:
                heatMode = 'heating';
                break;

            case Characteristics.TargetHeatingCoolingState.COOL:
                heatMode = 'cooling';
                break;

            case Characteristics.TargetHeatingCoolingState.AUTO:
                heatMode = 'auto';
                temperature = autoTemp;
                break;

            default:
                temperature = autoTemp;
                break;
        }

        temperature = Math.round(temperature);
        this.debug('FROM ' + currentState + '/' + currentTemperature + ' TO ' + state + '/' + temperature + ' with fan ' + fanMode);

        return new Command('globalControl', [onOff, temperature, fanMode, heatMode, progMode]);
    }
}
