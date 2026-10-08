/* MPL-2.0. Device logic adapted from onikoro334274-cell/mGBA_celio_edition
 * rom64 dee555365, src/platform/qt/CelioNet.cpp. The protocol is unchanged;
 * browser JavaScript supplies the transport in place of Windows WinHTTP. */
#include <emscripten/emscripten.h>
#include <mgba/core/core.h>
#include <mgba/core/interface.h>
#include <mgba/internal/gba/gba.h>
#include <mgba/internal/gba/io.h>
#include <atomic>
#include <deque>
#include <vector>
#include <memory>
#include <string>
// celio_device.lua
enum LinkStatus : uint16_t {
	AwaitModeEmulator = 0xFF01,
	AwaitMode = 0xFF02,
	HandshakeReceived = 0xFF03,
	HandshakeFinished = 0xFF04,
	LinkConnected = 0xFF05,
	LinkReconnecting = 0xFF06,
	LinkClosed = 0xFF07,
	DeviceReady = 0xFF08,
	EmuTradeSessionFinished = 0xFF09,
	EmuSessionStarted = 0xFF0A,
	StatusDebug = 0xFFFF,
};

enum CommandType : uint16_t {
	CmdSetMode = 0x00,
	CmdCancel = 0x01,
	CmdSetModeMaster = 0x10,
	CmdSetModeSlave = 0x11,
	CmdStartHandshake = 0x12,
	CmdConnectLink = 0x13,
	CmdEmuSessionStart = 0xFF0A,
};

enum class Transive { Handshake, Crc, Command };
enum class Handshake { Waiting, Listening, WaitingToRespond, Responding };
enum class Mode { Master, Slave };

const uint32_t IE_REG = 0x200;
const uint32_t IF_REG = 0x202;
const uint16_t SIO_IRQ_MASK = 0x80;

class CelioNet {
public:
 struct Device;
 struct Incoming { bool isCommand; uint16_t command; std::vector<uint16_t> data; };
 struct Outgoing { bool status; uint16_t value; std::vector<uint16_t> data; };
 GBA* m_gba=nullptr; mSioMask mask{0xFFFF}; mSioMask* m_mask=&mask; mSioMask* oldMask=nullptr;
 std::unique_ptr<Device> m_device;
 std::atomic<bool> m_attached{false}, m_resetRequested{false};
 bool m_hasIncoming=false, m_deviceOn=false;
 std::deque<Incoming> m_incoming; std::deque<Outgoing> outgoing;
 void log(const std::string&) {}
 void setSioMask(uint16_t value) { mask.mask=value; }
 void emitStatus(uint16_t value) { if(outgoing.size()<4096) outgoing.push_back({true,value,{}}); }
 void emitData(const std::vector<uint16_t>& values) { if(outgoing.size()<4096) outgoing.push_back({false,0,values}); }
 void drainIncoming();
 static void sioReadHook(void*); static void vblankHook(void*); static void timer3Hook(void*);
 void stop();
};
struct CelioNet::Device {
	Handshake handshake = Handshake::Waiting;
	Transive transive = Transive::Handshake;
	bool emuReconnect = false;
	bool gbaReconnect = false;
	bool keepAlive = true;
	bool startResponse = false;
	bool startConnect = false;
	std::deque<uint16_t> receivedQueue;
	std::vector<uint16_t> transmitQueue;
	std::deque<uint16_t> currentTx;
	std::vector<uint16_t> currentRx;
	int emptyDirectionStreak = 0;
	uint16_t checksum = 0;
	bool timerEnabled = false;
	int timerCount = 0;
	Mode mode = Mode::Slave;

	void resetState(bool init) {
		Mode keep = mode;
		*this = Device();
		mode = keep;
		if (!init) {
			handshake = Handshake::Listening;
		}
	}
};

void CelioNet::drainIncoming() {
	if (m_resetRequested.exchange(false) && m_device) {
		m_device->resetState(true);
		m_device->mode = Mode::Slave;
		m_mask->mask = 0xFFFF;
	}
	if (!m_hasIncoming) {
		return;
	}
	std::deque<Incoming> items;
	{

		items.swap(m_incoming);
		m_hasIncoming = false;
	}
	Device* d = m_device.get();
	if (!d) {
		return;
	}
	for (Incoming& in : items) {
		if (!in.isCommand) {
			// celio_device:receive_data
			for (uint16_t v : in.data) {
				d->receivedQueue.push_back(v);
			}
			continue;
		}
		// celio_device:receive_command
		switch (in.command) {
		case CmdSetMode:
			log("device command SetMode");
			emitStatus(DeviceReady);
			emitStatus(AwaitMode);
			break;
		case CmdEmuSessionStart:
			emitStatus(AwaitMode);
			break;
		case CmdSetModeSlave:
			log("device command SetModeSlave");
			d->handshake = Handshake::Listening;
			d->mode = Mode::Slave;
			setSioMask(0x600B);
			break;
		case CmdSetModeMaster:
			log("device command SetModeMaster");
			d->handshake = Handshake::Listening;
			d->mode = Mode::Master;
			setSioMask(0x601F);
			break;
		case CmdStartHandshake:
			log("device command StartHandshake");
			d->startResponse = true;
			break;
		case CmdConnectLink:
			log("device command ConnectLink");
			d->startConnect = true;
			break;
		default:
			log("device unknown command " + std::to_string(in.command));
			break;
		}
	}
}

static void writeIo(GBA* gba, uint32_t reg, uint16_t value) {
	gba->memory.io[reg >> 1] = value;
}

static uint16_t readIo(GBA* gba, uint32_t reg) {
	return gba->memory.io[reg >> 1];
}

void CelioNet::sioReadHook(void* context) {
	CelioNet* self = static_cast<CelioNet*>(context);
	if (!self->m_attached) {
		return;
	}
	self->drainIncoming();
	Device* d = self->m_device.get();
	if (!d || !self->m_deviceOn) {
		return;
	}
	GBA* gba = self->m_gba;
	uint16_t rx = readIo(gba, 0x12A);
	uint16_t tx = 0;

	switch (d->transive) {
	case Transive::Handshake: {
		// transive_handshake
		bool done = false;
		if (rx == 0xB9A0 && d->handshake == Handshake::Listening) {
			self->emitStatus(HandshakeReceived);
			d->handshake = Handshake::WaitingToRespond;
		}
		if (d->startConnect) {
			self->emitStatus(LinkConnected);
			d->transive = Transive::Crc;
			tx = 0x8FFF;
			done = true;
		}
		if (!done) {
			if (rx == 0x8FFF) {
				self->emitStatus(LinkConnected);
				d->transive = Transive::Crc;
			}
			if (d->handshake == Handshake::Responding) {
				tx = 0xB9A0;
			} else {
				if (d->startResponse) {
					d->handshake = Handshake::Responding;
				}
				tx = 0xD15E;
			}
		}
		break;
	}
	case Transive::Crc: {
		// transive_crc
		auto flush = [self, d]() {
			std::vector<uint16_t> data(d->transmitQueue.begin(), d->transmitQueue.end());
			data.resize(32, 0);
			d->transmitQueue.clear();
			self->emitData(data);
		};
		if (d->emuReconnect && d->gbaReconnect) {
			flush();
			if (d->keepAlive) {
				self->log("device reconnecting");
				self->emitStatus(LinkReconnecting);
				d->resetState(false);
			} else {
				self->log("device link closed");
				self->emitStatus(LinkClosed);
			}
			if (d->timerEnabled) {
				d->timerEnabled = false;
			}
			d->timerCount = 0;
			GBAIOWrite(gba, GBA_REG_TM3CNT_HI, 0);
			GBAIOWrite(gba, GBA_REG_TM3CNT_LO, 0);
		} else {
			d->transive = Transive::Command;
		}
		tx = d->checksum;
		d->checksum = 0;
		break;
	}
	case Transive::Command: {
		// transive_command
		d->currentRx.push_back(rx);
		if (d->currentTx.empty()) {
			// load_tx_command
			if (d->receivedQueue.empty()) {
				d->currentTx.assign(8, 0);
			} else {
				for (int i = 0; i < 8 && !d->receivedQueue.empty(); ++i) {
					d->currentTx.push_back(d->receivedQueue.front());
					d->receivedQueue.pop_front();
				}
			}
			if (d->currentTx.size() >= 2 && d->currentTx[0] == 0xCAFE && d->currentTx[1] == 0x0017) {
				d->keepAlive = false;
			}
			if (d->currentTx[0] == 0x5FFF) {
				self->log("partner ready for reconnect");
				d->emuReconnect = true;
			}
		}
		if (d->currentRx.size() == 8) {
			if (d->currentRx[0] == 0x5FFF) {
				self->log("ready for reconnect");
				d->gbaReconnect = true;
			}
			// save_rx_command
			if (d->currentRx[0] == 0xCAFE && d->currentRx[1] == 0x0011) {
				++d->emptyDirectionStreak;
				if (d->emptyDirectionStreak > 1) {
					d->currentRx[0] = 0;
					d->currentRx[1] = 0;
				}
			} else {
				d->emptyDirectionStreak = 0;
			}
			bool queue = !d->transmitQueue.empty();
			for (uint16_t v : d->currentRx) {
				if (v) {
					queue = true;
					break;
				}
			}
			if (queue) {
				d->transmitQueue.insert(d->transmitQueue.end(), d->currentRx.begin(), d->currentRx.end());
			}
			d->currentRx.clear();
			d->transive = Transive::Crc;
		}
		if (d->transmitQueue.size() >= 32) {
			std::vector<uint16_t> data(d->transmitQueue.begin(), d->transmitQueue.end());
			data.resize(32, 0);
			d->transmitQueue.clear();
			self->emitData(data);
		}
		tx = d->currentTx.front();
		d->currentTx.pop_front();
		d->checksum = (uint16_t) (d->checksum + tx);
		d->checksum = (uint16_t) (d->checksum + rx);
		break;
	}
	}

	if (d->mode == Mode::Master) {
		writeIo(gba, 0x120, tx);
		writeIo(gba, 0x122, rx);
	} else {
		writeIo(gba, 0x120, rx);
		writeIo(gba, 0x122, tx);
	}
	writeIo(gba, 0x124, 0xFFFF);
	writeIo(gba, 0x126, 0xFFFF);
}

void CelioNet::vblankHook(void* context) {
	CelioNet* self = static_cast<CelioNet*>(context);
	if (!self->m_attached) {
		return;
	}
	self->drainIncoming();
	Device* d = self->m_device.get();
	if (!d || !self->m_deviceOn) {
		return;
	}
	GBA* gba = self->m_gba;
	// sync_timer
	uint16_t ie = readIo(gba, IE_REG);
	if (d->mode == Mode::Slave || !(ie & SIO_IRQ_MASK)) {
		if (d->timerEnabled) {
			d->timerEnabled = false;
			d->timerCount = 0;
			GBAIOWrite(gba, GBA_REG_TM3CNT_HI, 0);
			GBAIOWrite(gba, GBA_REG_TM3CNT_LO, 0);
		}
		return;
	}
	writeIo(gba, IF_REG, readIo(gba, IF_REG) | SIO_IRQ_MASK);
	if (d->transive == Transive::Crc && !d->timerEnabled) {
		d->timerEnabled = true;
		GBAIOWrite(gba, GBA_REG_TM3CNT_LO, 0xFED0);
		GBAIOWrite(gba, GBA_REG_TM3CNT_HI, 0x00C1);
	}
}

void CelioNet::timer3Hook(void* context) {
	CelioNet* self = static_cast<CelioNet*>(context);
	if (!self->m_attached) {
		return;
	}
	Device* d = self->m_device.get();
	if (!d || !self->m_deviceOn) {
		return;
	}
	GBA* gba = self->m_gba;
	// transmission_timer
	uint16_t ie = readIo(gba, IE_REG);
	if (d->mode == Mode::Slave || !(ie & SIO_IRQ_MASK)) {
		return;
	}
	writeIo(gba, IF_REG, (readIo(gba, IF_REG) & 0xFFBF) | SIO_IRQ_MASK);
	if (d->timerCount == 7) {
		d->timerEnabled = false;
		d->timerCount = 0;
		GBAIOWrite(gba, GBA_REG_TM3CNT_HI, 0);
		GBAIOWrite(gba, GBA_REG_TM3CNT_LO, 0);
	} else {
		++d->timerCount;
	}
}

static CelioNet devices[2];
void CelioNet::stop() {
 if(!m_attached.exchange(false)) return;
 if(m_gba) {
  if(m_device && m_device->timerEnabled) { GBAIOWrite(m_gba,GBA_REG_TM3CNT_HI,0); GBAIOWrite(m_gba,GBA_REG_TM3CNT_LO,0); }
  m_gba->sioMask=oldMask; m_gba->sioReadHook=nullptr; m_gba->sioReadHookContext=nullptr;
 }
 m_gba=nullptr; m_device.reset(); m_incoming.clear(); outgoing.clear(); m_deviceOn=false; m_hasIncoming=false;
}
extern "C" {
void celio_stop(unsigned slot) { if(slot<2) devices[slot].stop(); }
int celio_start(unsigned slot,mCore* core) {
 if(slot>1 || !core || core->platform(core)!=mPLATFORM_GBA) return 0;
 auto& d=devices[slot]; d.stop(); d.m_gba=static_cast<GBA*>(core->board);
 d.oldMask=d.m_gba->sioMask; d.mask.mask=0xFFFF; d.m_gba->sioMask=&d.mask;
 d.m_gba->sioReadHook=CelioNet::sioReadHook; d.m_gba->sioReadHookContext=&d;
 mCoreCallbacks callbacks{}; callbacks.context=&d; callbacks.vblankIRQ=CelioNet::vblankHook; callbacks.timer3IRQ=CelioNet::timer3Hook;
 core->addCoreCallbacks(core,&callbacks); d.m_device.reset(new CelioNet::Device); d.m_resetRequested=false;
 d.m_attached=true; d.m_deviceOn=true; return 1;
}
EMSCRIPTEN_KEEPALIVE int web_celio_command(unsigned slot,unsigned command) {
 if(slot>1 || !devices[slot].m_attached || command>65535) return 0;
 auto& d=devices[slot]; if(d.m_incoming.size()>=4096) return 0;
 d.m_incoming.push_back({true,(uint16_t)command,{}}); d.m_hasIncoming=true; d.drainIncoming(); return 1;
}
EMSCRIPTEN_KEEPALIVE int web_celio_receive(unsigned slot,const uint16_t* values,unsigned count) {
 if(slot>1 || !devices[slot].m_attached || !values || count>32) return 0;
 auto& d=devices[slot]; if(d.m_device->receivedQueue.size()>32768) return 0;
 d.m_incoming.push_back({false,0,std::vector<uint16_t>(values,values+count)}); d.m_hasIncoming=true; d.drainIncoming(); return 1;
}
static uint16_t output[34];
EMSCRIPTEN_KEEPALIVE unsigned web_celio_poll(unsigned slot) {
 if(slot>1 || devices[slot].outgoing.empty()) return 0;
 auto item=std::move(devices[slot].outgoing.front()); devices[slot].outgoing.pop_front();
 output[0]=item.status?1:2; output[1]=item.status?item.value:item.data.size();
 for(unsigned i=0;i<item.data.size() && i<32;++i) output[i+2]=item.data[i];
 return (unsigned)(uintptr_t)output;
}
EMSCRIPTEN_KEEPALIVE void web_celio_reset(unsigned slot) { if(slot<2) { devices[slot].m_resetRequested=true; devices[slot].drainIncoming(); } }
}
