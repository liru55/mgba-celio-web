/* Dialog for the built-in Celio net link (see CelioNet.h).
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
#include "CelioNetView.h"

#include "CelioNet.h"
#include "CoreController.h"
#include "Window.h"

#include <QApplication>
#include <QClipboard>
#include <QGridLayout>
#include <QHBoxLayout>
#include <QLabel>
#include <QLineEdit>
#include <QPushButton>
#include <QRegularExpressionValidator>
#include <QVBoxLayout>

#include <cstdlib>
#include <cstring>

using namespace QGBA;

CelioNetView::CelioNetView(Window* window, QWidget* parent)
	: QDialog(parent, Qt::WindowTitleHint | Qt::WindowSystemMenuHint | Qt::WindowCloseButtonHint)
	, m_window(window)
{
	setWindowTitle(tr("ネット通信"));
	connect(window, &QObject::destroyed, this, &QWidget::close);

	QVBoxLayout* layout = new QVBoxLayout(this);

	QLabel* help = new QLabel(tr(
		"ネット越しに通信対戦・交換をします（Celio の中継サーバーを使います）。\n"
		"1. どちらか 1 人が「へやを つくる」を押し、出た 4 けたの番号を相手に伝える\n"
		"2. 相手は番号を入れて「へやに はいる」を押す\n"
		"3. 2 人とも、ゲームのポケモンセンター 2 階の受付で通信をはじめる\n"
		"2 人とも同じ ROM を使ってください。"));
	help->setWordWrap(true);
	layout->addWidget(help);

	QHBoxLayout* createRow = new QHBoxLayout;
	m_create = new QPushButton(tr("へやを つくる"));
	createRow->addWidget(m_create);
	createRow->addStretch();
	layout->addLayout(createRow);

	QHBoxLayout* joinRow = new QHBoxLayout;
	m_roomInput = new QLineEdit;
	m_roomInput->setPlaceholderText(tr("4 けたの番号"));
	m_roomInput->setMaxLength(4);
	m_roomInput->setValidator(new QRegularExpressionValidator(QRegularExpression("[0-9]{0,4}"), m_roomInput));
	m_join = new QPushButton(tr("へやに はいる"));
	joinRow->addWidget(m_roomInput);
	joinRow->addWidget(m_join);
	layout->addLayout(joinRow);

	QHBoxLayout* roomRow = new QHBoxLayout;
	m_room = new QLabel;
	QFont font = m_room->font();
	font.setPointSize(font.pointSize() * 2);
	font.setBold(true);
	m_room->setFont(font);
	m_room->setTextInteractionFlags(Qt::TextSelectableByMouse);
	m_copy = new QPushButton(tr("番号を コピー"));
	roomRow->addWidget(m_room);
	roomRow->addWidget(m_copy);
	roomRow->addStretch();
	layout->addLayout(roomRow);

	m_status = new QLabel;
	m_status->setWordWrap(true);
	layout->addWidget(m_status);

	m_disconnect = new QPushButton(tr("通信を やめる"));
	layout->addWidget(m_disconnect);

	connect(m_create, &QAbstractButton::clicked, this, &CelioNetView::create);
	connect(m_join, &QAbstractButton::clicked, this, &CelioNetView::join);
	connect(m_roomInput, &QLineEdit::returnPressed, this, &CelioNetView::join);
	connect(m_disconnect, &QAbstractButton::clicked, this, &CelioNetView::disconnectLink);
	connect(m_copy, &QAbstractButton::clicked, this, &CelioNetView::copyRoom);
	connect(&m_timer, &QTimer::timeout, this, &CelioNetView::refresh);
	m_timer.start(200);
	refresh();
}

void CelioNetView::hookController(std::shared_ptr<CoreController> controller) {
	CoreController* raw = controller.get();
	QObject::connect(raw, &CoreController::stopping, []() {
		CelioNet::instance()->stop(false);
	});
	const char* env = getenv("MGBA_CELIO_NET");
	if (!env || !*env) {
		return;
	}
	std::string mode = env;
	std::weak_ptr<CoreController> weak = controller;
	auto conn = std::make_shared<QMetaObject::Connection>();
	*conn = QObject::connect(raw, &CoreController::started, [weak, mode, conn]() {
		QObject::disconnect(*conn);
		QTimer::singleShot(1000, [weak, mode]() {
			std::shared_ptr<CoreController> c = weak.lock();
			if (!c) {
				return;
			}
			std::string room;
			if (mode.compare(0, 5, "join:") == 0) {
				room = mode.substr(5);
			}
			CelioNet::instance()->start(c, room);
		});
	});
}

void CelioNetView::create() {
	CelioNet::instance()->start(m_window->controller(), std::string());
	refresh();
}

void CelioNetView::join() {
	QString room = m_roomInput->text().trimmed();
	if (room.isEmpty()) {
		return;
	}
	while (room.size() < 4) {
		room.prepend('0');
	}
	CelioNet::instance()->start(m_window->controller(), room.toStdString());
	refresh();
}

void CelioNetView::disconnectLink() {
	CelioNet::instance()->stop();
	refresh();
}

void CelioNetView::copyRoom() {
	CelioNet::Snapshot s = CelioNet::instance()->snapshot();
	if (!s.room.empty()) {
		QApplication::clipboard()->setText(QString::fromStdString(s.room));
	}
}

void CelioNetView::refresh() {
	CelioNet* net = CelioNet::instance();
	CelioNet::Snapshot s = net->snapshot();
	bool running = s.active && s.state != CelioNet::State::Finished && s.state != CelioNet::State::Error;
	if (s.active && !running) {
		// The link ended by itself: release the SIO port
		net->stop();
		s = net->snapshot();
	}
	bool hasGame = m_window->controller() != nullptr;
	m_create->setEnabled(hasGame && !running);
	m_join->setEnabled(hasGame && !running);
	m_roomInput->setEnabled(!running);
	m_disconnect->setEnabled(running);
	m_copy->setEnabled(!s.room.empty() && running);
	m_room->setText(running && !s.room.empty() ? tr("へや %1").arg(QString::fromStdString(s.room)) : QString());
	QString status = QString::fromUtf8(s.message.c_str());
	if (!hasGame && !running) {
		status = tr("ゲームを起動してから使ってください");
	}
	m_status->setText(status);
}
