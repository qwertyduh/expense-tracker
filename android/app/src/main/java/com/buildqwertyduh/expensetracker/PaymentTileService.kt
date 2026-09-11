package com.buildqwertyduh.expensetracker

import android.graphics.drawable.Icon
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/**
 * Quick Settings tile to pause/resume payment detection instantly (e.g. when
 * someone borrows the phone). Shares its state with the capture handler and the
 * app's Settings screen via PaymentPrefs.
 */
class PaymentTileService : TileService() {

    override fun onStartListening() {
        super.onStartListening()
        updateTile()
    }

    override fun onClick() {
        super.onClick()
        PaymentPrefs.setEnabled(this, !PaymentPrefs.isEnabled(this))
        updateTile()
    }

    private fun updateTile() {
        val tile = qsTile ?: return
        val enabled = PaymentPrefs.isEnabled(this)
        tile.state = if (enabled) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        tile.label = "Expense capture"
        tile.icon = Icon.createWithResource(this, R.mipmap.ic_launcher)
        tile.updateTile()
    }
}
